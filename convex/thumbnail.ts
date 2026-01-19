import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

// Thumbnail error types for structured error handling
export type ThumbnailError =
  | "NETWORK_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_PDF"
  | "TIMEOUT"
  | "UNKNOWN";

export interface ThumbnailResult {
  success: boolean;
  thumbnailFileId?: string;
  error?: ThumbnailError;
  errorMessage?: string;
}

// Default timeout for thumbnail generation (30 seconds)
const THUMBNAIL_TIMEOUT = 30000;

// Helper to get headers for LaTeX service requests (includes API key if configured)
function getLatexServiceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.LATEX_SERVICE_API_KEY;
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

// Fetch with timeout using AbortSignal
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = THUMBNAIL_TIMEOUT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`TIMEOUT: Request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Custom error class for HTTP response errors
class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Classify error into a structured type
function classifyError(error: unknown): { type: ThumbnailError; message: string } {
  // Handle AbortError (timeout)
  if (error instanceof DOMException && error.name === "AbortError") {
    return { type: "TIMEOUT", message: error.message };
  }

  // Handle HttpError with status codes
  if (error instanceof HttpError) {
    const status = error.status;
    if (status >= 500 && status < 600) {
      return { type: "SERVICE_UNAVAILABLE", message: error.message };
    }
    if (status === 400 || status === 422) {
      return { type: "INVALID_PDF", message: error.message };
    }
    return { type: "UNKNOWN", message: error.message };
  }

  // Handle TypeError (often network errors)
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    if (message.includes("fetch") || message.includes("network") || message.includes("failed")) {
      return { type: "NETWORK_ERROR", message: error.message };
    }
    return { type: "UNKNOWN", message: error.message };
  }

  if (error instanceof Error) {
    const message = error.message;
    const lowerMessage = message.toLowerCase();

    // Check for explicit TIMEOUT marker (from our fetchWithTimeout)
    if (message.startsWith("TIMEOUT:") || lowerMessage.includes("timed out")) {
      return { type: "TIMEOUT", message };
    }

    // Check for network-related errors
    if (
      lowerMessage.includes("fetch failed") ||
      lowerMessage.includes("network") ||
      lowerMessage.includes("econnrefused") ||
      lowerMessage.includes("enotfound") ||
      lowerMessage.includes("dns")
    ) {
      return { type: "NETWORK_ERROR", message };
    }

    // Check for service unavailable patterns
    if (
      lowerMessage.includes("503") ||
      lowerMessage.includes("502") ||
      lowerMessage.includes("unavailable") ||
      lowerMessage.includes("service error")
    ) {
      return { type: "SERVICE_UNAVAILABLE", message };
    }

    // Check for invalid PDF patterns
    if (
      lowerMessage.includes("invalid pdf") ||
      lowerMessage.includes("corrupt") ||
      lowerMessage.includes("not a pdf") ||
      lowerMessage.includes("could not get pdf")
    ) {
      return { type: "INVALID_PDF", message };
    }

    return { type: "UNKNOWN", message };
  }

  return { type: "UNKNOWN", message: String(error) };
}

// Update paper with thumbnail
export const updatePaperThumbnail = internalMutation({
  args: {
    id: v.id("papers"),
    thumbnailFileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      thumbnailFileId: args.thumbnailFileId,
    });
  },
});

// Generate thumbnail from PDF with improved error handling
export const generateThumbnail = internalAction({
  args: { pdfFileId: v.id("_storage"), paperId: v.id("papers") },
  handler: async (ctx, args): Promise<ThumbnailResult> => {
    const latexServiceUrl = process.env.LATEX_SERVICE_URL;
    if (!latexServiceUrl) {
      console.log("LATEX_SERVICE_URL not configured, skipping thumbnail generation");
      return {
        success: false,
        error: "SERVICE_UNAVAILABLE",
        errorMessage: "LATEX_SERVICE_URL not configured",
      };
    }

    try {
      // Fetch the PDF from storage
      const pdfUrl = await ctx.storage.getUrl(args.pdfFileId);
      if (!pdfUrl) {
        console.log("Could not get PDF URL for thumbnail generation");
        return {
          success: false,
          error: "INVALID_PDF",
          errorMessage: "Could not get PDF URL from storage",
        };
      }

      const pdfResponse = await fetchWithTimeout(pdfUrl, { timeout: 30000 });
      if (!pdfResponse.ok) {
        console.log("Could not fetch PDF for thumbnail generation");
        return {
          success: false,
          error: "INVALID_PDF",
          errorMessage: `Failed to fetch PDF: ${pdfResponse.status}`,
        };
      }

      const pdfBuffer = await pdfResponse.arrayBuffer();
      const pdfBase64 = btoa(
        new Uint8Array(pdfBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      // Call the thumbnail endpoint with timeout
      const response = await fetchWithTimeout(`${latexServiceUrl}/thumbnail`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          pdfBase64,
          width: 400,
          format: "png",
        }),
        timeout: THUMBNAIL_TIMEOUT,
      });

      if (!response.ok) {
        const error = await response.text();
        console.log(`Thumbnail generation failed: ${error}`);
        return {
          success: false,
          error: response.status >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_PDF",
          errorMessage: error,
        };
      }

      // Store the thumbnail in Convex storage
      const thumbnailBuffer = await response.arrayBuffer();
      const thumbnailBlob = new Blob([thumbnailBuffer], { type: "image/png" });
      const thumbnailFileId = await ctx.storage.store(thumbnailBlob);

      // Update the paper with the thumbnail
      await ctx.runMutation(internal.thumbnail.updatePaperThumbnail, {
        id: args.paperId,
        thumbnailFileId,
      });

      return {
        success: true,
        thumbnailFileId: thumbnailFileId,
      };
    } catch (error) {
      const classified = classifyError(error);
      console.error("Thumbnail generation error:", classified.message);
      return {
        success: false,
        error: classified.type,
        errorMessage: classified.message,
      };
    }
  },
});

// Public action to generate thumbnail for a paper's PDF
export const generateThumbnailForPaper = action({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args): Promise<ThumbnailResult> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const paper = await ctx.runQuery(internal.git.getPaper, { id: args.paperId });
    if (!paper || !paper.pdfFileId) {
      return {
        success: false,
        error: "INVALID_PDF",
        errorMessage: "Paper not found or has no PDF",
      };
    }

    if (paper.userId && paper.userId !== userId) {
      throw new Error("Unauthorized");
    }
    if (paper.repositoryId) {
      const repository = await ctx.runQuery(internal.git.getRepository, { id: paper.repositoryId });
      if (!repository || repository.userId !== userId) {
        throw new Error("Unauthorized");
      }
    }

    try {
      return await ctx.runAction(internal.thumbnail.generateThumbnail, {
        pdfFileId: paper.pdfFileId,
        paperId: args.paperId,
      });
    } catch (error) {
      const classified = classifyError(error);
      console.error("Thumbnail generation failed:", classified.message);
      return {
        success: false,
        error: classified.type,
        errorMessage: classified.message,
      };
    }
  },
});

// Get papers that need thumbnails (have PDF but no thumbnail)
export const getPapersNeedingThumbnails = internalQuery({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.db.query("papers").collect();
    return papers.filter((p) => p.pdfFileId && !p.thumbnailFileId);
  },
});

// Regenerate thumbnails for all papers that need them
export const regenerateAllThumbnails = internalAction({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.runQuery(internal.thumbnail.getPapersNeedingThumbnails, {});

    console.log(`Found ${papers.length} papers needing thumbnails`);

    let generated = 0;
    let failed = 0;
    const errors: Array<{ paperId: string; error: ThumbnailError; message: string }> = [];

    for (const paper of papers) {
      try {
        const result = await ctx.runAction(internal.thumbnail.generateThumbnail, {
          pdfFileId: paper.pdfFileId!,
          paperId: paper._id,
        });
        if (result.success) {
          generated++;
        } else {
          failed++;
          errors.push({
            paperId: paper._id,
            error: result.error || "UNKNOWN",
            message: result.errorMessage || "Unknown error",
          });
        }
      } catch (error) {
        const classified = classifyError(error);
        console.error(`Failed to generate thumbnail for paper ${paper._id}:`, classified.message);
        failed++;
        errors.push({
          paperId: paper._id,
          error: classified.type,
          message: classified.message,
        });
      }
    }

    return { total: papers.length, generated, failed, errors: errors.slice(0, 10) };
  },
});

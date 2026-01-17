import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

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

// Generate thumbnail from PDF
export const generateThumbnail = internalAction({
  args: { pdfFileId: v.id("_storage"), paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const latexServiceUrl = process.env.LATEX_SERVICE_URL;
    if (!latexServiceUrl) {
      console.log("LATEX_SERVICE_URL not configured, skipping thumbnail generation");
      return null;
    }

    try {
      // Fetch the PDF from storage
      const pdfUrl = await ctx.storage.getUrl(args.pdfFileId);
      if (!pdfUrl) {
        console.log("Could not get PDF URL for thumbnail generation");
        return null;
      }

      const pdfResponse = await fetch(pdfUrl);
      if (!pdfResponse.ok) {
        console.log("Could not fetch PDF for thumbnail generation");
        return null;
      }

      const pdfBuffer = await pdfResponse.arrayBuffer();
      const pdfBase64 = btoa(
        new Uint8Array(pdfBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      // Call the thumbnail endpoint
      const response = await fetch(`${latexServiceUrl}/thumbnail`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          pdfBase64,
          width: 400,
          format: "png",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.log(`Thumbnail generation failed: ${error}`);
        return null;
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

      return thumbnailFileId;
    } catch (error) {
      console.error("Thumbnail generation error:", error);
      return null;
    }
  },
});

// Public action to generate thumbnail for a paper's PDF
export const generateThumbnailForPaper = action({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const paper = await ctx.runQuery(internal.git.getPaper, { id: args.paperId });
    if (!paper || !paper.pdfFileId) {
      return null;
    }

    try {
      return await ctx.runAction(internal.thumbnail.generateThumbnail, {
        pdfFileId: paper.pdfFileId,
        paperId: args.paperId,
      });
    } catch (error) {
      console.error("Thumbnail generation failed:", error);
      return null;
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
export const regenerateAllThumbnails = action({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.runQuery(internal.thumbnail.getPapersNeedingThumbnails, {});

    console.log(`Found ${papers.length} papers needing thumbnails`);

    let generated = 0;
    let failed = 0;

    for (const paper of papers) {
      try {
        const result = await ctx.runAction(internal.thumbnail.generateThumbnail, {
          pdfFileId: paper.pdfFileId!,
          paperId: paper._id,
        });
        if (result) {
          generated++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`Failed to generate thumbnail for paper ${paper._id}:`, error);
        failed++;
      }
    }

    return { total: papers.length, generated, failed };
  },
});

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import {
  parseOverleafUrl,
  getProviderFromUrl,
} from "./lib/gitProviders";
import {
  getGitHubToken,
  getGitLabToken,
  getOverleafCredentials,
  getAllSelfHostedGitLabInstances,
  getGitHubTokenByUserId,
  getGitLabTokenByUserId,
  getOverleafCredentialsByUserId,
  getAllSelfHostedGitLabInstancesByUserId,
} from "./git";
import type { Id } from "./_generated/dataModel";
import {
  fetchWithRetry,
  getLatexServiceHeaders,
  DEFAULT_LATEX_SERVICE_TIMEOUT,
  type DependencyHash,
} from "./lib/http";

// Comprehensive LaTeX extensions for full archive fetch
const LATEX_EXTENSIONS = [
  ".tex", ".sty", ".cls", ".bst", ".bib",      // Core LaTeX
  ".bbx", ".cbx", ".lbx", ".dbx",              // Biblatex
  ".def", ".cfg", ".fd", ".dtx", ".ins",       // Package/font definitions
  ".png", ".jpg", ".jpeg", ".pdf", ".eps", ".svg", ".gif",  // Images
  ".tikz", ".pgf",                              // TikZ
];

// Helper to get authentication for any git provider
async function getAuthForProvider(
  ctx: ActionCtx,
  provider: string,
  gitUrl: string,
  selfHostedInstances: Array<{ url: string; token: string }>,
  userId?: Id<"users">
): Promise<{ username: string; password: string } | undefined> {
  if (provider === "overleaf") {
    const creds = userId
      ? await getOverleafCredentialsByUserId(ctx, userId)
      : await getOverleafCredentials(ctx);
    return creds ?? undefined;
  }
  if (provider === "github") {
    const token = userId
      ? await getGitHubTokenByUserId(ctx, userId)
      : await getGitHubToken(ctx);
    return token ? { username: "x-access-token", password: token } : undefined;
  }
  if (provider === "gitlab") {
    const token = userId
      ? await getGitLabTokenByUserId(ctx, userId)
      : await getGitLabToken(ctx);
    return token ? { username: "oauth2", password: token } : undefined;
  }
  if (provider === "selfhosted-gitlab") {
    // Find the matching instance by URL
    const matching = selfHostedInstances.find(i => gitUrl.startsWith(i.url));
    return matching ? { username: "oauth2", password: matching.token } : undefined;
  }
  return undefined;
}

// Helper to fetch blob hashes for dependencies
// Uses batch fetch to optimize (single clone instead of one per file)
async function fetchDependencyHashes(
  ctx: ActionCtx,
  gitUrl: string,
  branch: string,
  dependencies: string[],
  userId?: Id<"users">
): Promise<DependencyHash[]> {
  if (dependencies.length === 0) {
    return [];
  }

  try {
    // Fetch all hashes in one batch call
    const hashes = await ctx.runAction(internal.git.fetchFileHashBatchInternal, {
      gitUrl,
      filePaths: dependencies,
      branch,
      userId,
    });

    // Convert to array format, filtering out files that couldn't be hashed
    const results: DependencyHash[] = [];
    for (const dep of dependencies) {
      const hash = hashes[dep];
      if (hash) {
        results.push({ path: dep, hash });
      } else {
        console.log(`Could not fetch hash for ${dep}`);
      }
    }
    return results;
  } catch (error) {
    console.log(`Could not fetch dependency hashes: ${error}`);
    return [];
  }
}

// Compile LaTeX file using LaTeX service
export const compileLatex = action({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    // Delegate to the internal implementation
    return await ctx.runAction(internal.latex.compileLatexInternal, args);
  },
});

// Internal action wrapper for compileLatex
export const compileLatexInternal = internalAction({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
    paperId: v.optional(v.id("papers")),
    userId: v.optional(v.id("users")), // Optional userId for mobile auth
  },
  handler: async (ctx, args) => {
    // Helper to update progress in UI
    const updateProgress = async (message: string | null) => {
      if (args.paperId) {
        await ctx.runMutation(internal.papers.updateCompilationProgress, {
          paperId: args.paperId,
          progress: message,
        });
      }
    };

    // Get the LaTeX service URL from environment
    const latexServiceUrl = process.env.LATEX_SERVICE_URL;
    if (!latexServiceUrl) {
      throw new Error("LATEX_SERVICE_URL not configured. Required for LaTeX compilation.");
    }

    // Get all self-hosted GitLab instances - use userId if provided (mobile)
    const selfHostedInstances = args.userId
      ? await getAllSelfHostedGitLabInstancesByUserId(ctx, args.userId)
      : await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Get authentication for the provider
    const auth = await getAuthForProvider(ctx, provider, args.gitUrl, selfHostedInstances, args.userId);

    // For Overleaf, convert project URL to git URL
    let archiveGitUrl = args.gitUrl;
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (overleafParsed) {
        archiveGitUrl = overleafParsed.gitUrl;
      }
    }

    // Fetch all LaTeX-related files via selective archive
    await updateProgress("Fetching all LaTeX files...");

    const archiveResponse = await fetchWithRetry(`${latexServiceUrl}/git/selective-archive`, {
      method: "POST",
      headers: getLatexServiceHeaders(),
      body: JSON.stringify({
        gitUrl: archiveGitUrl,
        branch: args.branch,
        auth,
        extensions: LATEX_EXTENSIONS,
      }),
      timeout: 120000,
    });

    if (!archiveResponse.ok) {
      await updateProgress(null);
      let errorMessage = "Failed to fetch repository files";
      try {
        const responseText = await archiveResponse.text();
        if (responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html")) {
          errorMessage = `Failed to fetch repository files (HTTP ${archiveResponse.status}). ` +
            "This usually indicates an authentication error or service issue.";
        } else {
          try {
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.error || errorMessage;
          } catch {
            errorMessage = responseText.length > 500
              ? `Failed to fetch repository files: ${responseText.substring(0, 500)}...`
              : `Failed to fetch repository files: ${responseText}`;
          }
        }
      } catch {
        errorMessage = `Failed to fetch repository files (HTTP ${archiveResponse.status})`;
      }
      throw new Error(errorMessage);
    }

    const { files } = await archiveResponse.json() as { files: Array<{ path: string; content: string; encoding?: string }> };
    console.log(`Fetched ${files.length} files for ${provider}`);

    if (files.length === 0) {
      await updateProgress(null);
      throw new Error("No LaTeX files found in repository.");
    }

    // Compile
    await updateProgress("Compiling LaTeX...");

    const pdfResponse = await fetchWithRetry(`${latexServiceUrl}/compile`, {
      method: "POST",
      headers: getLatexServiceHeaders(),
      body: JSON.stringify({
        resources: files,
        target: args.filePath,
        compiler: "pdflatex",
      }),
      timeout: DEFAULT_LATEX_SERVICE_TIMEOUT,
    }, 2);

    if (!pdfResponse.ok) {
      await updateProgress(null);
      let errorMessage = "LaTeX compilation failed";
      try {
        const responseText = await pdfResponse.text();

        // Check if response is an HTML error page (proxy error, login page, etc.)
        if (responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html")) {
          errorMessage = `LaTeX service returned an HTML error page (HTTP ${pdfResponse.status}). ` +
            "This usually indicates a proxy error, service outage, or misconfiguration.";
        } else {
          // Try to parse as JSON
          try {
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.error || errorMessage;
            if (errorData.log) {
              errorMessage += "\n\nLog:\n" + errorData.log;
            }
          } catch {
            // Not JSON, use raw text (truncated if too long)
            errorMessage = responseText.length > 500
              ? responseText.substring(0, 500) + "..."
              : responseText;
          }
        }
      } catch {
        errorMessage = `LaTeX compilation failed with HTTP ${pdfResponse.status}`;
      }
      throw new Error(errorMessage);
    }

    console.log(`Compile succeeded with ${files.length} files`);

    // Get dependencies from X-Dependencies header (parsed from .fls file by latex-service)
    let finalDependencies: string[] = [];
    const depsHeader = pdfResponse.headers.get("X-Dependencies");
    if (depsHeader) {
      try {
        const parsed = JSON.parse(depsHeader) as string[];
        finalDependencies = [...new Set(parsed)];
        console.log(`Detected ${finalDependencies.length} dependencies from .fls`);
      } catch {
        console.log("Failed to parse X-Dependencies header");
      }
    }

    // Fallback if no dependencies in header - use all source files
    if (finalDependencies.length === 0) {
      const sourceExtensions = [".tex", ".sty", ".cls", ".bst", ".bib", ".bbx", ".cbx", ".lbx", ".dbx", ".def", ".cfg", ".fd"];
      finalDependencies = files
        .map(f => f.path)
        .filter(p => sourceExtensions.some(ext => p.endsWith(ext)));
      console.log(`Using ${finalDependencies.length} source files as dependencies (fallback)`);
    }

    // Store PDF
    await updateProgress("Storing PDF...");
    const pdfBuffer = await pdfResponse.arrayBuffer();

    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);

    // Fetch blob hashes for dependencies (for file-level change detection)
    let dependencyHashes: DependencyHash[] = [];
    if (finalDependencies.length > 0) {
      await updateProgress("Caching dependency info...");
      dependencyHashes = await fetchDependencyHashes(
        ctx,
        args.gitUrl,
        args.branch,
        finalDependencies,
        args.userId
      );
      console.log(`Cached ${dependencyHashes.length} dependency hashes`);
    }

    await updateProgress(null);

    return {
      storageId,
      size: pdfBuffer.byteLength,
      dependencies: dependencyHashes,
    };
  },
});

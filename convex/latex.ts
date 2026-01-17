import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import {
  parseOverleafUrl,
  parseRepoUrl,
  getProviderFromUrl,
} from "./lib/gitProviders";
import { fetchTexFilesOnly, fetchSingleFile } from "./lib/fileFetching";
import {
  getGitHubToken,
  getGitLabToken,
  getOverleafCredentials,
  getAllSelfHostedGitLabInstances,
} from "./git";

// Type for dependency with hash
type DependencyHash = { path: string; hash: string };

// Normalize a path and ensure it stays within the repository root
// Returns null if the path would escape the root
function normalizePath(basePath: string, relativePath: string): string | null {
  // Combine the paths
  const combined = basePath ? `${basePath}/${relativePath}` : relativePath;

  // Split into segments and resolve . and ..
  const segments: string[] = [];
  for (const segment of combined.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    } else if (segment === "..") {
      if (segments.length === 0) {
        // Would escape the root
        return null;
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }

  return segments.join("/");
}

// Helper to fetch blob hashes for dependencies
async function fetchDependencyHashes(
  ctx: ActionCtx,
  gitUrl: string,
  branch: string,
  dirPath: string,
  dependencies: string[]
): Promise<DependencyHash[]> {
  const results: DependencyHash[] = [];

  for (const dep of dependencies) {
    // Build the full path for the dependency
    const fullPath = dirPath ? `${dirPath}/${dep}` : dep;

    try {
      const hash = await ctx.runAction(internal.git.fetchFileHashInternal, {
        gitUrl,
        filePath: fullPath,
        branch,
      });
      results.push({ path: dep, hash });
    } catch (error) {
      // Skip files that can't be hashed (e.g., system files, missing files)
      console.log(`Could not fetch hash for ${fullPath}: ${error}`);
    }
  }

  return results;
}

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

// Compile LaTeX file using LaTeX.Online API
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

    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Get the LaTeX service URL from environment
    const latexServiceUrl = process.env.LATEX_SERVICE_URL;

    // Determine the directory of the target file (for resolving relative paths)
    const dirPath = args.filePath.includes("/")
      ? args.filePath.substring(0, args.filePath.lastIndexOf("/"))
      : "";

    let pdfResponse: Response;
    // Track dependencies for file-level change detection
    let finalDependencies: string[] = [];

    // Handle Overleaf projects - fetch all files via git archive endpoint
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (!overleafParsed) {
        throw new Error(`Invalid Overleaf URL: "${args.gitUrl}". Expected format: https://git.overleaf.com/<project_id> or https://www.overleaf.com/project/<project_id>`);
      }

      if (!latexServiceUrl) {
        throw new Error("LATEX_SERVICE_URL not configured. Required for Overleaf support.");
      }

      const credentials = await getOverleafCredentials(ctx);
      if (!credentials) {
        throw new Error("Overleaf credentials not configured.");
      }

      await updateProgress("Fetching files from Overleaf...");

      // Fetch all project files via git archive
      const archiveResponse = await fetch(`${latexServiceUrl}/git/archive`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          branch: args.branch,
          auth: credentials,
        }),
      });

      if (!archiveResponse.ok) {
        await updateProgress(null);
        const error = await archiveResponse.text();
        throw new Error(`Failed to fetch Overleaf project files: ${error}`);
      }

      const archiveData = await archiveResponse.json();
      const allFiles = archiveData.files as Array<{ path: string; content: string; encoding?: string }>;

      if (allFiles.length === 0) {
        throw new Error("No files found in Overleaf project");
      }

      console.log(`Fetched ${allFiles.length} files from Overleaf`);

      // Convert to resources map, adjusting paths relative to target directory
      const allResources: Map<string, { path: string; content: string; encoding?: string }> = new Map();
      for (const f of allFiles) {
        let relativePath = f.path;
        if (dirPath && relativePath.startsWith(dirPath + "/")) {
          relativePath = relativePath.slice(dirPath.length + 1);
        }
        allResources.set(relativePath, { path: relativePath, content: f.content, encoding: f.encoding });
      }

      // For Overleaf, all fetched files are dependencies
      finalDependencies = Array.from(allResources.keys());

      await updateProgress(`Compiling LaTeX (${allResources.size} files)...`);

      // Compile with all files
      pdfResponse = await fetch(`${latexServiceUrl}/compile`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          resources: Array.from(allResources.values()),
          target: args.filePath,
          compiler: "pdflatex",
        }),
      });
    } else {
      // GitHub/GitLab handling (both gitlab.com and self-hosted)
      const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
      if (!parsed) {
        throw new Error("Invalid repository URL. Expected GitHub, GitLab, or Overleaf URL.");
      }

      console.log(`[compileLatexInternal] Parsed URL: provider=${parsed.provider}, owner=${parsed.owner}, repo=${parsed.repo}, matchedInstanceUrl=${parsed.matchedInstanceUrl || "N/A"}`);

      // Get the appropriate token based on provider
      const isSelfHosted = parsed.provider === "selfhosted-gitlab";

      // Find the matching self-hosted instance if applicable
      const matchingInstance = isSelfHosted
        ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
        : null;

      if (isSelfHosted && !matchingInstance) {
        console.error(`[compileLatexInternal] Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. Available instances: ${selfHostedInstances.map(i => i.url).join(", ")}`);
      }

      const token = parsed.provider === "github"
        ? await getGitHubToken(ctx)
        : isSelfHosted
          ? matchingInstance?.token
          : await getGitLabToken(ctx);

      console.log(`[compileLatexInternal] Token available: ${!!token}, isSelfHosted: ${isSelfHosted}`);

      // For self-hosted GitLab, we need the base URL for API calls
      const gitlabBaseUrl = isSelfHosted ? matchingInstance?.url || "" : "https://gitlab.com";
      // Normalize provider for helper functions (selfhosted-gitlab uses same API as gitlab)
      // Type assertion needed because TypeScript doesn't narrow parsed.provider when isSelfHosted is false
      const effectiveProvider: "github" | "gitlab" = isSelfHosted ? "gitlab" : (parsed.provider as "github" | "gitlab");

    if (latexServiceUrl) {
      // Iterative dependency resolution: keep finding deps until no new missing files
      await updateProgress("Fetching .tex files from repository...");

      // Step 1: Fetch all .tex files from the directory
      const texFiles = await fetchTexFilesOnly(
        parsed.owner,
        parsed.repo,
        args.branch,
        dirPath,
        token || "",
        effectiveProvider,
        isSelfHosted ? gitlabBaseUrl : undefined
      );

      if (texFiles.length === 0) {
        throw new Error(
          "No .tex files found in directory. " +
          "This may happen if: (1) the directory has no .tex files, " +
          "(2) authentication is required but not configured, or " +
          "(3) the repository returned an error page instead of file content."
        );
      }

      console.log(`Found ${texFiles.length} .tex files: ${texFiles.map(f => f.path).join(", ")}`);

      // Track all resources we have (relative paths)
      const allResources: Map<string, { path: string; content: string; encoding?: string }> = new Map();

      // Add .tex files - keep full paths to preserve directory structure
      // This allows relative references like ../file.sty to work correctly
      for (const f of texFiles) {
        allResources.set(f.path, { path: f.path, content: f.content });
      }

      // Track files we've already tried to fetch (to avoid infinite loops)
      const attemptedFetches = new Set<string>();

      // Iteratively resolve dependencies (max 5 iterations to prevent infinite loops)
      const MAX_ITERATIONS = 5;
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        console.log(`\nDependency resolution iteration ${iteration + 1}`);
        await updateProgress(`Detecting dependencies (pass ${iteration + 1})...`);

        // Send current resources to /deps
        const depsResponse = await fetch(`${latexServiceUrl}/deps`, {
          method: "POST",
          headers: getLatexServiceHeaders(),
          body: JSON.stringify({
            resources: Array.from(allResources.values()),
            target: args.filePath,
            compiler: "pdflatex",
          }),
        });

        if (!depsResponse.ok) {
          const errorText = await depsResponse.text();
          throw new Error(`Dependency detection failed: ${errorText}`);
        }

        const depsResult = await depsResponse.json();
        console.log("Dependencies detected:", depsResult.dependencies?.length || 0);
        console.log("Missing files:", depsResult.missingFiles);

        // Store the dependencies from this iteration
        if (depsResult.dependencies && depsResult.dependencies.length > 0) {
          finalDependencies = depsResult.dependencies;
        }

        // If no missing files, we're done with dependency resolution
        if (!depsResult.missingFiles || depsResult.missingFiles.length === 0) {
          console.log("No missing files - dependency resolution complete");
          break;
        }

        // Collect files we need to fetch
        const filesToFetch = new Set<string>();

        for (const missing of depsResult.missingFiles) {
          // Build and normalize full path (handles .. references)
          const fullPath = normalizePath(dirPath, missing);

          // Skip if path would escape repository root
          if (fullPath === null) {
            console.log(`Skipping path that escapes repo root: ${missing}`);
            continue;
          }

          // Skip if already attempted
          if (attemptedFetches.has(fullPath)) continue;

          filesToFetch.add(fullPath);
          attemptedFetches.add(fullPath);

          // Also try with common extensions if no extension
          if (!missing.includes(".")) {
            const extensions = [".bbx", ".cbx", ".bib", ".sty", ".cls", ".bst"];
            for (const ext of extensions) {
              const withExt = fullPath + ext;
              if (!attemptedFetches.has(withExt)) {
                filesToFetch.add(withExt);
                attemptedFetches.add(withExt);
              }
            }
          }
        }

        if (filesToFetch.size === 0) {
          console.log("No new files to fetch - stopping");
          break;
        }

        console.log(`Fetching ${filesToFetch.size} files: ${Array.from(filesToFetch).join(", ")}`);
        await updateProgress(`Fetching ${filesToFetch.size} missing files...`);

        // Fetch the missing files
        const fetchPromises = Array.from(filesToFetch).map((p) =>
          fetchSingleFile(parsed.owner, parsed.repo, args.branch, p, token || "", effectiveProvider, isSelfHosted ? gitlabBaseUrl : undefined)
        );
        const fetched = await Promise.all(fetchPromises);
        const newFiles = fetched.filter((f): f is NonNullable<typeof f> => f !== null);

        console.log(`Successfully fetched ${newFiles.length} files`);
        await updateProgress(`Fetched ${newFiles.length} files`);

        if (newFiles.length === 0) {
          console.log("Could not fetch any missing files - stopping");
          break;
        }

        // Add new files to resources - keep full paths to preserve directory structure
        for (const f of newFiles) {
          if (!allResources.has(f.path)) {
            allResources.set(f.path, {
              path: f.path,
              content: f.content,
              encoding: f.encoding,
            });
          }
        }
      }

      console.log(`\nCompiling with ${allResources.size} total files`);
      await updateProgress(`Compiling LaTeX (${allResources.size} files)...`);

      // Final compile with all resolved dependencies
      pdfResponse = await fetch(`${latexServiceUrl}/compile`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          resources: Array.from(allResources.values()),
          target: args.filePath,
          compiler: "pdflatex",
        }),
      });
    } else {
      // Fallback to LaTeX.Online for public repos
      let repoCheckUrl: string;
      if (parsed.provider === "github") {
        repoCheckUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
      } else {
        const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
        repoCheckUrl = `https://gitlab.com/api/v4/projects/${projectId}`;
      }

      const repoCheckResponse = await fetch(repoCheckUrl, {
        headers: {
          "User-Agent": "PaperShelf",
        },
      });

      let isPublicRepo = false;
      if (repoCheckResponse.ok) {
        if (parsed.provider === "gitlab") {
          const repoData = await repoCheckResponse.json();
          isPublicRepo = repoData.visibility === "public";
        } else {
          isPublicRepo = true;
        }
      }

      if (isPublicRepo) {
        const repoUrl = parsed.provider === "github"
          ? `https://github.com/${parsed.owner}/${parsed.repo}`
          : `https://gitlab.com/${parsed.owner}/${parsed.repo}`;
        const compileUrl = `https://latexonline.cc/compile?git=${encodeURIComponent(repoUrl)}&target=${encodeURIComponent(args.filePath)}&branch=${encodeURIComponent(args.branch)}`;
        pdfResponse = await fetch(compileUrl);
      } else {
        throw new Error(
          "Private repo compilation requires LATEX_SERVICE_URL to be configured. " +
          "See latex-service/README.md for setup instructions."
        );
      }
    }
    } // Close GitHub/GitLab else block

    if (!pdfResponse.ok) {
      await updateProgress(null); // Clear progress on error
      let errorMessage = "LaTeX compilation failed";
      try {
        const errorData = await pdfResponse.json();
        errorMessage = errorData.error || errorMessage;
        if (errorData.log) {
          errorMessage += "\n\nLog:\n" + errorData.log;
        }
      } catch {
        errorMessage = await pdfResponse.text();
      }
      throw new Error(errorMessage);
    }

    await updateProgress("Storing PDF...");
    const pdfBuffer = await pdfResponse.arrayBuffer();

    // Store PDF directly in Convex storage (avoids array size limits)
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
        dirPath,
        finalDependencies
      );
      console.log(`Cached ${dependencyHashes.length} dependency hashes`);
    }

    await updateProgress(null); // Clear progress on success

    return {
      storageId,
      size: pdfBuffer.byteLength,
      dependencies: dependencyHashes,
    };
  },
});

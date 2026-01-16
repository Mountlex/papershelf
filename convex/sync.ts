import { v } from "convex/values";
import { action, internalMutation, internalQuery, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import type { Id } from "./_generated/dataModel";

// Helper to get GitHub token for authenticated user
async function getGitHubToken(ctx: ActionCtx): Promise<string | null> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return null;

  // Get the user record which contains the GitHub access token
  const user = await ctx.runQuery(internal.sync.getUser, { userId });
  return user?.githubAccessToken || null;
}

// Parse GitHub URL to extract owner and repo
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

// Fetch repository info from GitHub API
export const fetchRepositoryInfo = action({
  args: { gitUrl: v.string() },
  handler: async (ctx, args) => {
    const parsed = parseGitHubUrl(args.gitUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub URL");
    }

    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "PaperShelf",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      name: data.name,
      fullName: data.full_name,
      defaultBranch: data.default_branch,
      description: data.description,
      private: data.private,
    };
  },
});

// Fetch latest commit hash from GitHub
export const fetchLatestCommit = action({
  args: {
    gitUrl: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const parsed = parseGitHubUrl(args.gitUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub URL");
    }

    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${args.branch}`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "PaperShelf",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      sha: data.sha,
      message: data.commit.message,
      date: data.commit.committer.date,
    };
  },
});

// Fetch file content from GitHub (for committed PDFs)
export const fetchFileContent = action({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const parsed = parseGitHubUrl(args.gitUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub URL");
    }

    // Use raw GitHub content URL for binary files
    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${args.branch}/${args.filePath}`;

    const response = await fetch(rawUrl, {
      headers: {
        "User-Agent": "PaperShelf",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      content: Array.from(new Uint8Array(arrayBuffer)),
      size: arrayBuffer.byteLength,
    };
  },
});

// List files in a repository (for browsing when adding repo)
export const listRepositoryFiles = action({
  args: {
    gitUrl: v.string(),
    path: v.optional(v.string()),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const parsed = parseGitHubUrl(args.gitUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub URL");
    }

    const path = args.path || "";
    const branch = args.branch || "main";

    // Get token for private repo access
    const token = await getGitHubToken(ctx);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "PaperShelf",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path}?ref=${branch}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();

    // If it's a single file, wrap in array
    const files = Array.isArray(data) ? data : [data];

    return files.map((file: { name: string; path: string; type: string; size?: number }) => ({
      name: file.name,
      path: file.path,
      type: file.type as "file" | "dir",
      size: file.size,
    }));
  },
});

// Internal mutation to update repository after sync
export const updateRepositoryAfterSync = internalMutation({
  args: {
    id: v.id("repositories"),
    lastCommitHash: v.string(),
    lastSyncedAt: v.number(),
    syncStatus: v.union(v.literal("idle"), v.literal("syncing"), v.literal("error")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      lastCommitHash: args.lastCommitHash,
      lastSyncedAt: args.lastSyncedAt,
      syncStatus: args.syncStatus,
    });
  },
});

// Sync a repository - fetch latest commit and update PDFs if needed
export const syncRepository = action({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    // Get repository from DB
    const repository = await ctx.runQuery(internal.sync.getRepository, {
      id: args.repositoryId,
    });

    if (!repository) {
      throw new Error("Repository not found");
    }

    // Fetch latest commit
    const latestCommit = await ctx.runAction(internal.sync.fetchLatestCommitInternal, {
      gitUrl: repository.gitUrl,
      branch: repository.defaultBranch,
    });

    // Check if we need to update
    if (repository.lastCommitHash === latestCommit.sha) {
      // No changes, just update sync time
      await ctx.runMutation(internal.sync.updateRepositoryAfterSync, {
        id: args.repositoryId,
        lastCommitHash: latestCommit.sha,
        lastSyncedAt: Date.now(),
        syncStatus: "idle",
      });
      return { updated: false, commitHash: latestCommit.sha };
    }

    // Update repository with new commit
    await ctx.runMutation(internal.sync.updateRepositoryAfterSync, {
      id: args.repositoryId,
      lastCommitHash: latestCommit.sha,
      lastSyncedAt: Date.now(),
      syncStatus: "idle",
    });

    return { updated: true, commitHash: latestCommit.sha };
  },
});

// Internal query to get repository (for use in actions)
export const getRepository = internalQuery({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get user by ID (to retrieve access token)
export const getUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

// Get paper by ID
export const getPaper = internalQuery({
  args: { id: v.id("papers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get tracked file by ID
export const getTrackedFile = internalQuery({
  args: { id: v.id("trackedFiles") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Update paper with PDF info
export const updatePaperPdf = internalMutation({
  args: {
    id: v.id("papers"),
    pdfFileId: v.id("_storage"),
    cachedCommitHash: v.string(),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      pdfFileId: args.pdfFileId,
      cachedCommitHash: args.cachedCommitHash,
      fileSize: args.fileSize,
      updatedAt: Date.now(),
    });
  },
});

// Get GitHub account for a user (legacy - keeping for reference)
export const getGitHubAccount = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("provider"), "github")
        )
      )
      .first();
    return account;
  },
});

// Internal action wrapper for fetchLatestCommit
export const fetchLatestCommitInternal = action({
  args: {
    gitUrl: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const parsed = parseGitHubUrl(args.gitUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub URL. Expected format: https://github.com/owner/repo");
    }

    // Get token for private repo access
    const token = await getGitHubToken(ctx);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "PaperShelf",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${args.branch}`,
      { headers }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Repository or branch not found: ${parsed.owner}/${parsed.repo} (branch: ${args.branch}). ` +
          `Make sure the repository exists and you have access.`
        );
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return {
      sha: data.sha,
      message: data.commit.message,
      date: data.commit.committer.date,
    };
  },
});

// Compile LaTeX file using LaTeX.Online API
export const compileLatex = action({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    // Delegate to the internal implementation
    return await ctx.runAction(internal.sync.compileLatexInternal, args);
  },
});

// Sync a single paper - compile/fetch its PDF
export const syncPaper = action({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    // Get paper and related data
    const paper = await ctx.runQuery(internal.sync.getPaper, { id: args.paperId });
    if (!paper) throw new Error("Paper not found");

    const trackedFile = await ctx.runQuery(internal.sync.getTrackedFile, { id: paper.trackedFileId });
    if (!trackedFile) throw new Error("Tracked file not found");

    const repository = await ctx.runQuery(internal.sync.getRepository, { id: paper.repositoryId });
    if (!repository) throw new Error("Repository not found");

    // Fetch latest commit to check if we need to update
    const latestCommit = await ctx.runAction(internal.sync.fetchLatestCommitInternal, {
      gitUrl: repository.gitUrl,
      branch: repository.defaultBranch,
    });

    // Check if PDF is already cached for this commit
    if (paper.cachedCommitHash === latestCommit.sha && paper.pdfFileId) {
      return { updated: false, commitHash: latestCommit.sha };
    }

    let storageId: string;
    let fileSize: number;

    if (trackedFile.pdfSourceType === "compile") {
      // Compile LaTeX - returns storage ID directly
      const result = await ctx.runAction(internal.sync.compileLatexInternal, {
        gitUrl: repository.gitUrl,
        filePath: trackedFile.filePath,
        branch: repository.defaultBranch,
      });
      storageId = result.storageId;
      fileSize = result.size;
    } else {
      // Fetch committed PDF
      const pdfData = await ctx.runAction(internal.sync.fetchFileContentInternal, {
        gitUrl: repository.gitUrl,
        filePath: trackedFile.filePath,
        branch: repository.defaultBranch,
      });
      // Store PDF in Convex storage
      const blob = new Blob([new Uint8Array(pdfData.content)], { type: "application/pdf" });
      storageId = await ctx.storage.store(blob);
      fileSize = pdfData.size;
    }

    // Update paper with new PDF
    await ctx.runMutation(internal.sync.updatePaperPdf, {
      id: args.paperId,
      pdfFileId: storageId as Id<"_storage">,
      cachedCommitHash: latestCommit.sha,
      fileSize,
    });

    return { updated: true, commitHash: latestCommit.sha };
  },
});

// Binary file extensions that need base64 encoding
const BINARY_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif",
  ".eps", ".ps", ".svg", ".ico", ".webp", ".zip", ".tar", ".gz",
]);

function isBinaryFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return BINARY_EXTENSIONS.has(ext);
}

// Helper to fetch directory contents recursively from GitHub
async function fetchDirectoryFiles(
  owner: string,
  repo: string,
  branch: string,
  dirPath: string,
  token: string
): Promise<Array<{ path: string; content: string; encoding?: string }>> {
  const files: Array<{ path: string; content: string; encoding?: string }> = [];

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "PaperShelf",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // List contents of directory
  const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
  const listResponse = await fetch(listUrl, { headers });

  if (!listResponse.ok) {
    throw new Error(`Failed to list directory: ${listResponse.statusText}`);
  }

  const items = await listResponse.json();
  const itemList = Array.isArray(items) ? items : [items];

  for (const item of itemList) {
    if (item.type === "file") {
      // Skip very large files (over 5MB)
      if (item.size > 5000000) continue;

      // Fetch file content
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
      const fetchHeaders: Record<string, string> = { "User-Agent": "PaperShelf" };
      if (token) {
        fetchHeaders["Authorization"] = `Bearer ${token}`;
      }

      const fileResponse = await fetch(rawUrl, { headers: fetchHeaders });

      if (fileResponse.ok) {
        // Store path relative to the directory
        const relativePath = item.path.startsWith(dirPath + "/")
          ? item.path.slice(dirPath.length + 1)
          : item.name;

        if (isBinaryFile(item.name)) {
          // Read binary files as byte array
          const buffer = await fileResponse.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          files.push({ path: relativePath, content: bytes as unknown as string, encoding: "bytes" });
        } else {
          // Read text files as-is
          const content = await fileResponse.text();
          files.push({ path: relativePath, content });
        }
      }
    } else if (item.type === "dir") {
      // Recursively fetch subdirectory
      const subFiles = await fetchDirectoryFiles(owner, repo, branch, item.path, token);
      for (const subFile of subFiles) {
        const relativePath = item.path.startsWith(dirPath + "/")
          ? item.path.slice(dirPath.length + 1) + "/" + subFile.path
          : item.name + "/" + subFile.path;
        files.push({ path: relativePath, content: subFile.content, encoding: subFile.encoding });
      }
    }
  }

  return files;
}

// Internal action wrapper for compileLatex
export const compileLatexInternal = action({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const parsed = parseGitHubUrl(args.gitUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub URL");
    }

    const token = await getGitHubToken(ctx);

    // Get the LaTeX service URL from environment
    const latexServiceUrl = process.env.LATEX_SERVICE_URL;

    // Determine the directory and filename
    const dirPath = args.filePath.includes("/")
      ? args.filePath.substring(0, args.filePath.lastIndexOf("/"))
      : "";
    const fileName = args.filePath.includes("/")
      ? args.filePath.substring(args.filePath.lastIndexOf("/") + 1)
      : args.filePath;

    let pdfResponse: Response;

    if (latexServiceUrl) {
      // Use self-hosted LaTeX service
      const files = await fetchDirectoryFiles(
        parsed.owner,
        parsed.repo,
        args.branch,
        dirPath || ".",
        token || ""
      );

      if (files.length === 0) {
        throw new Error("No files found in the directory");
      }

      const resources = files.map((f) => ({
        path: f.path,
        content: f.content,
        encoding: f.encoding,
      }));

      pdfResponse = await fetch(`${latexServiceUrl}/compile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resources,
          target: fileName,
          compiler: "pdflatex",
        }),
      });
    } else {
      // Fallback to LaTeX.Online for public repos
      const repoCheckResponse = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "PaperShelf",
          },
        }
      );

      const isPublicRepo = repoCheckResponse.ok;

      if (isPublicRepo) {
        const repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
        const compileUrl = `https://latexonline.cc/compile?git=${encodeURIComponent(repoUrl)}&target=${encodeURIComponent(args.filePath)}&branch=${encodeURIComponent(args.branch)}`;
        pdfResponse = await fetch(compileUrl);
      } else {
        throw new Error(
          "Private repo compilation requires LATEX_SERVICE_URL to be configured. " +
          "See latex-service/README.md for setup instructions."
        );
      }
    }

    if (!pdfResponse.ok) {
      let errorMessage = "LaTeX compilation failed";
      try {
        const errorData = await pdfResponse.json();
        errorMessage = errorData.error || errorMessage;
        if (errorData.log) {
          errorMessage += "\n\nLog:\n" + errorData.log.slice(-500);
        }
      } catch {
        errorMessage = await pdfResponse.text();
      }
      throw new Error(errorMessage.slice(0, 1000));
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();

    // Store PDF directly in Convex storage (avoids array size limits)
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);

    return {
      storageId,
      size: pdfBuffer.byteLength,
    };
  },
});

// Internal action wrapper for fetchFileContent
export const fetchFileContentInternal = action({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const parsed = parseGitHubUrl(args.gitUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub URL");
    }

    const token = await getGitHubToken(ctx);
    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${args.branch}/${args.filePath}`;

    const headers: Record<string, string> = {
      "User-Agent": "PaperShelf",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(rawUrl, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      content: Array.from(new Uint8Array(arrayBuffer)),
      size: arrayBuffer.byteLength,
    };
  },
});

// List user's GitHub repositories
export const listUserRepos = action({
  args: {},
  handler: async (ctx) => {
    const token = await getGitHubToken(ctx);
    if (!token) {
      throw new Error("Not authenticated with GitHub");
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "PaperShelf",
      Authorization: `Bearer ${token}`,
    };

    // Fetch user's repos (includes private repos they have access to)
    const response = await fetch(
      "https://api.github.com/user/repos?sort=updated&per_page=100",
      { headers }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return data.map((repo: {
      name: string;
      full_name: string;
      html_url: string;
      description: string | null;
      private: boolean;
      default_branch: string;
      updated_at: string;
      owner: { avatar_url: string };
    }) => ({
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      description: repo.description,
      isPrivate: repo.private,
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at,
      ownerAvatar: repo.owner.avatar_url,
    }));
  },
});

// Fetch repository info and return default branch (used when adding repos)
export const fetchRepoInfo = action({
  args: { gitUrl: v.string() },
  handler: async (ctx, args) => {
    const parsed = parseGitHubUrl(args.gitUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub URL. Expected format: https://github.com/owner/repo");
    }

    // Try to get the user's GitHub token for private repo access
    const token = await getGitHubToken(ctx);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "PaperShelf",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      { headers }
    );

    if (!response.ok) {
      if (response.status === 404) {
        const privateNote = token
          ? "Check that you have access to this repository."
          : "If this is a private repository, sign in with GitHub first.";
        throw new Error(
          `Repository not found: ${parsed.owner}/${parsed.repo}. ${privateNote}`
        );
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return {
      name: data.name as string,
      defaultBranch: data.default_branch as string,
      isPrivate: data.private as boolean,
    };
  },
});

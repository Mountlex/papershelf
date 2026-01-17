import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import type { Id } from "./_generated/dataModel";
import {
  parseOverleafUrl,
  parseRepoUrl,
  getProviderFromUrl,
  type SelfHostedGitLabInstance,
} from "./lib/gitProviders";

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

// Helper to get GitHub token for authenticated user
export async function getGitHubToken(ctx: ActionCtx): Promise<string | null> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return null;

  // Get the user record which contains the GitHub access token
  const user = await ctx.runQuery(internal.git.getUser, { userId });
  return user?.githubAccessToken || null;
}

// Helper to get GitLab token for authenticated user
export async function getGitLabToken(ctx: ActionCtx): Promise<string | null> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return null;

  const user = await ctx.runQuery(internal.git.getUser, { userId });
  return user?.gitlabAccessToken || null;
}

// Helper to get Overleaf credentials for authenticated user
// Note: Overleaf Git auth uses username "git" with the token as password
export async function getOverleafCredentials(ctx: ActionCtx): Promise<{ username: string; password: string } | null> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return null;

  const user = await ctx.runQuery(internal.git.getUser, { userId });
  if (user?.overleafEmail && user?.overleafToken) {
    // Overleaf requires username "git" and token as password
    return { username: "git", password: user.overleafToken };
  }
  return null;
}

// Helper to get all self-hosted GitLab instances for authenticated user
export async function getAllSelfHostedGitLabInstances(ctx: ActionCtx): Promise<SelfHostedGitLabInstance[]> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return [];

  const instances = await ctx.runQuery(internal.git.getSelfHostedGitLabInstancesInternal, { userId });
  return instances || [];
}

// Helper to get self-hosted GitLab credentials by instance ID
export async function getSelfHostedGitLabCredentialsById(
  ctx: ActionCtx,
  instanceId: Id<"selfHostedGitLabInstances">
): Promise<{ url: string; token: string } | null> {
  const instance = await ctx.runQuery(internal.git.getSelfHostedGitLabInstanceById, { id: instanceId });
  if (!instance) return null;
  return { url: instance.url, token: instance.token };
}

// Get user by ID (to retrieve access token)
export const getUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

// Get all self-hosted GitLab instances for a user (internal, includes token)
export const getSelfHostedGitLabInstancesInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const instances = await ctx.db
      .query("selfHostedGitLabInstances")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return instances;
  },
});

// Get a self-hosted GitLab instance by ID (internal, includes token)
export const getSelfHostedGitLabInstanceById = internalQuery({
  args: { id: v.id("selfHostedGitLabInstances") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
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

// Get repository by ID
export const getRepository = internalQuery({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Fetch repository info from GitHub or GitLab API
export const fetchRepositoryInfo = action({
  args: { gitUrl: v.string() },
  handler: async (ctx, args) => {
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL. Expected GitHub or GitLab URL.");
    }

    if (parsed.provider === "github") {
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
    } else {
      // GitLab API (both gitlab.com and self-hosted) - project ID is URL-encoded owner/repo
      const isSelfHosted = parsed.provider === "selfhosted-gitlab";
      const matchingInstance = isSelfHosted
        ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
        : null;
      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);

      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
      const headers: Record<string, string> = {
        "User-Agent": "PaperShelf",
      };
      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }

      const response = await fetch(
        `${baseUrl}/api/v4/projects/${projectId}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error(`GitLab API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        name: data.name,
        fullName: data.path_with_namespace,
        defaultBranch: data.default_branch,
        description: data.description,
        private: data.visibility !== "public",
      };
    }
  },
});

// Fetch latest commit hash from GitHub or GitLab
export const fetchLatestCommit = action({
  args: {
    gitUrl: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL. Expected GitHub or GitLab URL.");
    }

    if (parsed.provider === "github") {
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
    } else {
      // GitLab API (both gitlab.com and self-hosted)
      const isSelfHosted = parsed.provider === "selfhosted-gitlab";
      const matchingInstance = isSelfHosted
        ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
        : null;
      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);

      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
      const headers: Record<string, string> = {
        "User-Agent": "PaperShelf",
      };
      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }

      const response = await fetch(
        `${baseUrl}/api/v4/projects/${projectId}/repository/commits/${encodeURIComponent(args.branch)}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error(`GitLab API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        sha: data.id,
        message: data.message,
        date: data.committed_date,
      };
    }
  },
});

// Fetch file content from GitHub or GitLab (for committed PDFs)
export const fetchFileContent = action({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL. Expected GitHub or GitLab URL.");
    }

    let rawUrl: string;
    const headers: Record<string, string> = {
      "User-Agent": "PaperShelf",
    };

    if (parsed.provider === "github") {
      rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${args.branch}/${args.filePath}`;
      const token = await getGitHubToken(ctx);
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } else {
      // GitLab raw file URL (both gitlab.com and self-hosted)
      const isSelfHosted = parsed.provider === "selfhosted-gitlab";
      const matchingInstance = isSelfHosted
        ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
        : null;
      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);

      // Use GitLab API endpoint for raw file content (works with PRIVATE-TOKEN)
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
      const encodedFilePath = encodeURIComponent(args.filePath);
      rawUrl = `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedFilePath}/raw?ref=${args.branch}`;
      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }
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

// List files in a repository (for browsing when adding repo)
export const listRepositoryFiles = action({
  args: {
    gitUrl: v.string(),
    path: v.optional(v.string()),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);
    const path = args.path || "";
    const branch = args.branch || "main";

    // Handle Overleaf projects
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (!overleafParsed) {
        throw new Error(`Invalid Overleaf URL: "${args.gitUrl}". Expected format: https://git.overleaf.com/<project_id> or https://www.overleaf.com/project/<project_id>`);
      }

      const credentials = await getOverleafCredentials(ctx);
      if (!credentials) {
        throw new Error("Overleaf credentials not configured.");
      }

      const latexServiceUrl = process.env.LATEX_SERVICE_URL;
      if (!latexServiceUrl) {
        throw new Error("LATEX_SERVICE_URL not configured. Required for Overleaf support.");
      }

      const response = await fetch(`${latexServiceUrl}/git/tree`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          path,
          branch,
          auth: credentials,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to list Overleaf files: ${error}`);
      }

      const data = await response.json();
      return data.files as Array<{
        name: string;
        path: string;
        type: "file" | "dir";
        size?: number;
      }>;
    }

    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL. Expected GitHub, GitLab, or Overleaf URL.");
    }

    if (parsed.provider === "github") {
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
    } else {
      // GitLab API (both gitlab.com and self-hosted)
      const isSelfHosted = parsed.provider === "selfhosted-gitlab";
      const matchingInstance = isSelfHosted
        ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
        : null;
      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);

      const headers: Record<string, string> = {
        "User-Agent": "PaperShelf",
      };
      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }

      const params = new URLSearchParams({
        ref: branch,
        per_page: "100",
      });
      if (path) {
        params.set("path", path);
      }

      const response = await fetch(
        `${baseUrl}/api/v4/projects/${projectId}/repository/tree?${params}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error(`GitLab API error: ${response.statusText}`);
      }

      const data = await response.json();

      return data.map((file: { name: string; path: string; type: string }) => ({
        name: file.name,
        path: file.path,
        type: file.type === "tree" ? "dir" : "file",
        size: undefined, // GitLab tree endpoint doesn't return size
      }));
    }
  },
});

// Internal action wrapper for fetchLatestCommit
export const fetchLatestCommitInternal = action({
  args: {
    gitUrl: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Handle Overleaf projects
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (!overleafParsed) {
        throw new Error(`Invalid Overleaf URL: "${args.gitUrl}". Expected format: https://git.overleaf.com/<project_id> or https://www.overleaf.com/project/<project_id>`);
      }

      const credentials = await getOverleafCredentials(ctx);
      if (!credentials) {
        throw new Error("Overleaf credentials not configured.");
      }

      const latexServiceUrl = process.env.LATEX_SERVICE_URL;
      if (!latexServiceUrl) {
        throw new Error("LATEX_SERVICE_URL not configured. Required for Overleaf support.");
      }

      const response = await fetch(`${latexServiceUrl}/git/refs`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          branch: args.branch,
          auth: credentials,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get Overleaf commit: ${error}`);
      }

      const data = await response.json();
      return {
        sha: data.sha,
        message: data.message || "Overleaf commit",
        date: data.date || new Date().toISOString(),
      };
    }

    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error(`Invalid repository URL: "${args.gitUrl}". Expected format: https://github.com/owner/repo, https://gitlab.com/owner/repo, https://git.overleaf.com/<project_id>, or https://www.overleaf.com/project/<project_id>`);
    }

    if (parsed.provider === "github") {
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
        // Use generic error message to avoid information disclosure
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          throw new Error("Repository not found or access denied. Make sure the repository exists and you have the correct permissions.");
        }
        throw new Error("Failed to access repository. Please try again later.");
      }

      const data = await response.json();

      return {
        sha: data.sha,
        message: data.commit.message,
        date: data.commit.committer.date,
      };
    } else {
      // GitLab API (both gitlab.com and self-hosted)
      const isSelfHosted = parsed.provider === "selfhosted-gitlab";
      const matchingInstance = isSelfHosted
        ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
        : null;
      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);

      const headers: Record<string, string> = {
        "User-Agent": "PaperShelf",
      };
      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }

      const response = await fetch(
        `${baseUrl}/api/v4/projects/${projectId}/repository/commits/${encodeURIComponent(args.branch)}`,
        { headers }
      );

      if (!response.ok) {
        // Use generic error message to avoid information disclosure
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          throw new Error("Repository not found or access denied. Make sure the repository exists and you have the correct permissions.");
        }
        throw new Error("Failed to access repository. Please try again later.");
      }

      const data = await response.json();

      return {
        sha: data.id,
        message: data.message,
        date: data.committed_date,
      };
    }
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
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Handle Overleaf projects
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (!overleafParsed) {
        throw new Error(`Invalid Overleaf URL: "${args.gitUrl}". Expected format: https://git.overleaf.com/<project_id> or https://www.overleaf.com/project/<project_id>`);
      }

      const credentials = await getOverleafCredentials(ctx);
      if (!credentials) {
        throw new Error("Overleaf credentials not configured.");
      }

      const latexServiceUrl = process.env.LATEX_SERVICE_URL;
      if (!latexServiceUrl) {
        throw new Error("LATEX_SERVICE_URL not configured. Required for Overleaf support.");
      }

      const response = await fetch(`${latexServiceUrl}/git/file`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          filePath: args.filePath,
          branch: args.branch,
          auth: credentials,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to fetch file from Overleaf: ${error}`);
      }

      const data = await response.json();
      // Return in same format as GitHub/GitLab
      if (data.encoding === "base64") {
        const binaryString = atob(data.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return {
          content: Array.from(bytes),
          size: bytes.length,
        };
      }
      // Text file - convert to bytes
      const encoder = new TextEncoder();
      const bytes = encoder.encode(data.content);
      return {
        content: Array.from(bytes),
        size: bytes.length,
      };
    }

    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL. Expected GitHub, GitLab, or Overleaf URL.");
    }

    // Get the appropriate token based on provider
    const isSelfHosted = parsed.provider === "selfhosted-gitlab";

    // Find the matching self-hosted instance if applicable
    const matchingInstance = isSelfHosted
      ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
      : null;

    const baseUrl = isSelfHosted ? matchingInstance?.url || "" : "https://gitlab.com";
    const token = parsed.provider === "github"
      ? await getGitHubToken(ctx)
      : isSelfHosted
        ? matchingInstance?.token
        : await getGitLabToken(ctx);

    let rawUrl: string;
    const headers: Record<string, string> = {
      "User-Agent": "PaperShelf",
    };

    if (parsed.provider === "github") {
      rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${args.branch}/${args.filePath}`;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } else {
      // Use GitLab API endpoint for raw file content (works with PRIVATE-TOKEN)
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
      const encodedFilePath = encodeURIComponent(args.filePath);
      rawUrl = `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedFilePath}/raw?ref=${args.branch}`;
      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }
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
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Handle Overleaf projects
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (!overleafParsed) {
        throw new Error("Invalid Overleaf URL. Expected format: https://git.overleaf.com/<project_id> or https://www.overleaf.com/project/<project_id>");
      }

      const credentials = await getOverleafCredentials(ctx);
      if (!credentials) {
        throw new Error("Overleaf credentials not configured. Please set up your Overleaf account first.");
      }

      // Use latex-service to get repo info via git ls-remote
      const latexServiceUrl = process.env.LATEX_SERVICE_URL;
      if (!latexServiceUrl) {
        throw new Error("LATEX_SERVICE_URL not configured. Required for Overleaf support.");
      }

      const response = await fetch(`${latexServiceUrl}/git/refs`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          auth: credentials,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to access Overleaf project: ${error}`);
      }

      const data = await response.json();

      return {
        name: `Overleaf Project ${overleafParsed.projectId.substring(0, 8)}`,
        defaultBranch: data.defaultBranch || "master",
        isPrivate: true,
      };
    }

    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error(`Invalid repository URL: "${args.gitUrl}". Expected format: https://github.com/owner/repo, https://gitlab.com/owner/repo, https://git.overleaf.com/<project_id>, or https://www.overleaf.com/project/<project_id>`);
    }

    const headers: Record<string, string> = {
      "User-Agent": "PaperShelf",
    };

    if (parsed.provider === "github") {
      // Try to get the user's GitHub token for private repo access
      const token = await getGitHubToken(ctx);

      headers["Accept"] = "application/vnd.github.v3+json";
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
    } else {
      // GitLab API (both gitlab.com and self-hosted)
      const isSelfHosted = parsed.provider === "selfhosted-gitlab";
      const matchingInstance = isSelfHosted
        ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
        : null;
      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);

      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }

      const response = await fetch(
        `${baseUrl}/api/v4/projects/${projectId}`,
        { headers }
      );

      if (!response.ok) {
        if (response.status === 404) {
          const privateNote = token
            ? "Check that you have access to this repository."
            : isSelfHosted
              ? "Check that you have access to this repository and your PAT has the correct scopes."
              : "If this is a private repository, sign in with GitLab first.";
          throw new Error(
            `Repository not found: ${parsed.owner}/${parsed.repo}. ${privateNote}`
          );
        }
        throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return {
        name: data.name as string,
        defaultBranch: data.default_branch as string,
        isPrivate: data.visibility !== "public",
      };
    }
  },
});

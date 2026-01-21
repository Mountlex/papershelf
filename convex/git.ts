import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import type { Id } from "./_generated/dataModel";
import {
  parseOverleafUrl,
  parseRepoUrl,
  getProviderFromUrl,
  getGitLabHeaders,
  type SelfHostedGitLabInstance,
} from "./lib/gitProviders";
import {
  fetchWithTimeout,
  withTimeout,
  getLatexServiceHeaders,
  BATCH_OPERATION_TIMEOUT,
} from "./lib/http";
import { decryptTokenIfNeeded, encryptTokenIfNeeded } from "./lib/crypto";

// Token refresh buffer: refresh 5 minutes before expiry to avoid race conditions
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Helper to get GitHub token for authenticated user
export async function getGitHubToken(ctx: ActionCtx): Promise<string | null> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return null;
  return getGitHubTokenByUserId(ctx, userId);
}

// Helper to get GitHub token by userId (for mobile auth)
export async function getGitHubTokenByUserId(ctx: ActionCtx, userId: Id<"users">): Promise<string | null> {
  const user = await ctx.runQuery(internal.git.getUser, { userId });
  if (!user?.githubAccessToken) return null;
  return decryptTokenIfNeeded(user.githubAccessToken);
}

// Helper to get GitLab token for authenticated user (with automatic refresh)
export async function getGitLabToken(ctx: ActionCtx): Promise<string | null> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return null;
  return getGitLabTokenByUserId(ctx, userId);
}

// Helper to get GitLab token by userId (for mobile auth)
export async function getGitLabTokenByUserId(ctx: ActionCtx, userId: Id<"users">): Promise<string | null> {
  const user = await ctx.runQuery(internal.git.getUser, { userId });
  if (!user?.gitlabAccessToken) return null;

  // Check if token needs refresh (expired or expiring within buffer period)
  const now = Date.now();
  const expiresAt = user.gitlabTokenExpiresAt;

  // If we have expiry info and token is expired or expiring soon, try to refresh
  if (expiresAt && now >= expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    if (user.gitlabRefreshToken) {
      console.log("GitLab token expired or expiring soon, refreshing...");
      // Decrypt the refresh token first
      const decryptedRefreshToken = await decryptTokenIfNeeded(user.gitlabRefreshToken);
      if (decryptedRefreshToken) {
        const refreshed = await refreshGitLabToken(ctx, userId, decryptedRefreshToken);
        if (refreshed) {
          return refreshed.accessToken;
        }
      }
      // Token is expired and refresh failed - user needs to re-authenticate
      throw new Error("GitLab token expired. Please disconnect and reconnect your GitLab account in Settings.");
    } else {
      // Token is expired with no refresh token - user needs to re-authenticate
      throw new Error("GitLab token expired. Please disconnect and reconnect your GitLab account in Settings.");
    }
  }

  // Decrypt the token
  return decryptTokenIfNeeded(user.gitlabAccessToken);
}

// Helper to get Overleaf credentials for authenticated user
// Note: Overleaf Git auth uses username "git" with the token as password
export async function getOverleafCredentials(ctx: ActionCtx): Promise<{ username: string; password: string } | null> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return null;
  return getOverleafCredentialsByUserId(ctx, userId);
}

// Helper to get Overleaf credentials by userId (for mobile auth)
export async function getOverleafCredentialsByUserId(ctx: ActionCtx, userId: Id<"users">): Promise<{ username: string; password: string } | null> {
  const user = await ctx.runQuery(internal.git.getUser, { userId });
  if (user?.overleafEmail && user?.overleafToken) {
    const decryptedToken = await decryptTokenIfNeeded(user.overleafToken);
    if (!decryptedToken) return null;
    return { username: "git", password: decryptedToken };
  }
  return null;
}

// Helper to get all self-hosted GitLab instances for authenticated user
export async function getAllSelfHostedGitLabInstances(ctx: ActionCtx): Promise<SelfHostedGitLabInstance[]> {
  const userId = await auth.getUserId(ctx);
  if (!userId) return [];
  return getAllSelfHostedGitLabInstancesByUserId(ctx, userId);
}

// Helper to get all self-hosted GitLab instances by userId (for mobile auth)
export async function getAllSelfHostedGitLabInstancesByUserId(ctx: ActionCtx, userId: Id<"users">): Promise<SelfHostedGitLabInstance[]> {
  const instances = await ctx.runQuery(internal.git.getSelfHostedGitLabInstancesInternal, { userId });
  if (!instances) return [];

  // Decrypt tokens for all instances
  const decryptedInstances = await Promise.all(
    instances.map(async (instance) => {
      const decryptedToken = await decryptTokenIfNeeded(instance.token);
      if (!decryptedToken) {
        throw new Error(`Failed to decrypt token for GitLab instance: ${instance.name}`);
      }
      return {
        ...instance,
        token: decryptedToken,
      };
    })
  );

  return decryptedInstances;
}

// Helper to get self-hosted GitLab credentials by instance ID
export async function getSelfHostedGitLabCredentialsById(
  ctx: ActionCtx,
  instanceId: Id<"selfHostedGitLabInstances">
): Promise<{ url: string; token: string } | null> {
  const instance = await ctx.runQuery(internal.git.getSelfHostedGitLabInstanceById, { id: instanceId });
  if (!instance) return null;
  // Decrypt the token
  const decryptedToken = await decryptTokenIfNeeded(instance.token);
  if (!decryptedToken) return null;
  return { url: instance.url, token: decryptedToken };
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

// Internal mutation to update GitLab tokens after refresh
export const updateGitLabTokens = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Encrypt tokens before storing
    const encryptedAccessToken = await encryptTokenIfNeeded(args.accessToken);
    const encryptedRefreshToken = await encryptTokenIfNeeded(args.refreshToken);

    await ctx.db.patch(args.userId, {
      gitlabAccessToken: encryptedAccessToken,
      gitlabRefreshToken: encryptedRefreshToken,
      gitlabTokenExpiresAt: args.expiresAt,
    });
  },
});

// Refresh GitLab OAuth token using the refresh token
async function refreshGitLabToken(
  ctx: ActionCtx,
  userId: Id<"users">,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
  // Get OAuth client credentials from environment
  const clientId = process.env.AUTH_GITLAB_ID;
  const clientSecret = process.env.AUTH_GITLAB_SECRET;
  // Use CONVEX_SITE_URL for OAuth callback - this is the Convex HTTP actions URL
  // (e.g., https://xyz.convex.site), not the frontend URL
  const convexSiteUrl = process.env.CONVEX_SITE_URL;

  if (!clientId || !clientSecret || !convexSiteUrl) {
    console.error("GitLab OAuth credentials or CONVEX_SITE_URL not configured");
    return null;
  }

  try {
    const response = await fetchWithTimeout("https://gitlab.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        redirect_uri: `${convexSiteUrl}/api/auth/callback/gitlab`,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("GitLab token refresh failed:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const expiresIn = data.expires_in ?? 7200;
    const expiresAt = Date.now() + expiresIn * 1000;

    // Update the tokens in the database
    await ctx.runMutation(internal.git.updateGitLabTokens, {
      userId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    };
  } catch (error) {
    console.error("GitLab token refresh error:", error);
    return null;
  }
}

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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL. Expected GitHub or GitLab URL.");
    }

    if (parsed.provider === "github") {
      const response = await fetchWithTimeout(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Carrel",
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

      if (isSelfHosted && !matchingInstance) {
        throw new Error(
          `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
          `The instance may have been deleted. Please re-add the repository.`
        );
      }

      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);

      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
      const headers = getGitLabHeaders(token);

      const response = await fetchWithTimeout(
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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL. Expected GitHub or GitLab URL.");
    }

    if (parsed.provider === "github") {
      const response = await fetchWithTimeout(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${args.branch}`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Carrel",
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

      if (isSelfHosted && !matchingInstance) {
        throw new Error(
          `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
          `The instance may have been deleted. Please re-add the repository.`
        );
      }

      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);

      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
      const headers = getGitLabHeaders(token);

      const response = await fetchWithTimeout(
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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL. Expected GitHub or GitLab URL.");
    }

    let rawUrl: string;
    const headers: Record<string, string> = {
      "User-Agent": "Carrel",
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

      if (isSelfHosted && !matchingInstance) {
        throw new Error(
          `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
          `The instance may have been deleted. Please re-add the repository.`
        );
      }

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

    const response = await fetchWithTimeout(rawUrl, { headers });

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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
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

      const response = await fetchWithTimeout(`${latexServiceUrl}/git/tree`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          path,
          branch,
          auth: credentials,
        }),
        timeout: 60000, // 1 minute for git tree
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
        "User-Agent": "Carrel",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetchWithTimeout(
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

      if (isSelfHosted && !matchingInstance) {
        throw new Error(
          `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
          `The instance may have been deleted. Please re-add the repository.`
        );
      }

      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);

      const headers: Record<string, string> = {
        "User-Agent": "Carrel",
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

      const response = await fetchWithTimeout(
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
export const fetchLatestCommitInternal = internalAction({
  args: {
    gitUrl: v.string(),
    branch: v.string(),
    knownSha: v.optional(v.string()),
    userId: v.optional(v.id("users")), // Optional userId for mobile auth
  },
  handler: async (ctx, args) => {
    // Get all self-hosted GitLab instances - use userId if provided (mobile), otherwise use auth
    const selfHostedInstances = args.userId
      ? await getAllSelfHostedGitLabInstancesByUserId(ctx, args.userId)
      : await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Handle Overleaf projects
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (!overleafParsed) {
        throw new Error(`Invalid Overleaf URL: "${args.gitUrl}". Expected format: https://git.overleaf.com/<project_id> or https://www.overleaf.com/project/<project_id>`);
      }

      const credentials = args.userId
        ? await getOverleafCredentialsByUserId(ctx, args.userId)
        : await getOverleafCredentials(ctx);
      if (!credentials) {
        throw new Error("Overleaf credentials not configured.");
      }

      const latexServiceUrl = process.env.LATEX_SERVICE_URL;
      if (!latexServiceUrl) {
        throw new Error("LATEX_SERVICE_URL not configured. Required for Overleaf support.");
      }

      const response = await fetchWithTimeout(`${latexServiceUrl}/git/refs`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          branch: args.branch,
          auth: credentials,
          knownSha: args.knownSha,
        }),
        timeout: 30000, // 30 seconds for refs
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get Overleaf commit: ${error}`);
      }

      const data = await response.json();

      // If SHA unchanged, return without date (caller should use cached date)
      if (data.unchanged) {
        return {
          sha: data.sha,
          message: "Overleaf commit",
          unchanged: true as const,
        };
      }

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
      // Get token for private repo access - use userId if provided (mobile)
      const token = args.userId
        ? await getGitHubTokenByUserId(ctx, args.userId)
        : await getGitHubToken(ctx);

      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Carrel",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetchWithTimeout(
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

      if (isSelfHosted && !matchingInstance) {
        throw new Error(
          `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
          `The instance may have been deleted. Please re-add the repository.`
        );
      }

      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      // Use userId if provided (mobile)
      const token = isSelfHosted
        ? matchingInstance!.token
        : (args.userId ? await getGitLabTokenByUserId(ctx, args.userId) : await getGitLabToken(ctx));
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);

      const headers: Record<string, string> = {
        "User-Agent": "Carrel",
      };
      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }

      const response = await fetchWithTimeout(
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

// Fetch list of files changed between two commits
export const fetchChangedFilesInternal = internalAction({
  args: {
    gitUrl: v.string(),
    baseCommit: v.string(),
    headCommit: v.string(),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const selfHostedInstances = await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Overleaf doesn't support compare API - return empty to trigger full check
    if (provider === "overleaf") {
      return [];
    }

    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      return [];
    }

    try {
      if (parsed.provider === "github") {
        const token = await getGitHubToken(ctx);
        const headers: Record<string, string> = {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Carrel",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetchWithTimeout(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/compare/${args.baseCommit}...${args.headCommit}`,
          { headers }
        );

        if (!response.ok) {
          console.log(`GitHub compare API failed: ${response.status}`);
          return [];
        }

        const data = await response.json();
        return (data.files || []).map((f: { filename: string }) => f.filename);
      } else {
        // GitLab (both gitlab.com and self-hosted)
        const isSelfHosted = parsed.provider === "selfhosted-gitlab";
        const matchingInstance = isSelfHosted
          ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
          : null;

        const baseUrl = isSelfHosted ? matchingInstance?.url : "https://gitlab.com";
        const token = isSelfHosted ? matchingInstance?.token : await getGitLabToken(ctx);

        if (!baseUrl) return [];

        const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
        const headers = getGitLabHeaders(token);

        const response = await fetchWithTimeout(
          `${baseUrl}/api/v4/projects/${projectId}/repository/compare?from=${args.baseCommit}&to=${args.headCommit}`,
          { headers }
        );

        if (!response.ok) {
          console.log(`GitLab compare API failed: ${response.status}`);
          return [];
        }

        const data = await response.json();
        return (data.diffs || []).map((d: { new_path: string }) => d.new_path);
      }
    } catch (error) {
      console.log(`Failed to fetch changed files: ${error}`);
      return [];
    }
  },
});

// Internal action wrapper for fetchFileContent
export const fetchFileContentInternal = internalAction({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = args.userId
      ? await getAllSelfHostedGitLabInstancesByUserId(ctx, args.userId)
      : await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Handle Overleaf projects
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (!overleafParsed) {
        throw new Error(`Invalid Overleaf URL: "${args.gitUrl}". Expected format: https://git.overleaf.com/<project_id> or https://www.overleaf.com/project/<project_id>`);
      }

      const credentials = args.userId
        ? await getOverleafCredentialsByUserId(ctx, args.userId)
        : await getOverleafCredentials(ctx);
      if (!credentials) {
        throw new Error("Overleaf credentials not configured.");
      }

      const latexServiceUrl = process.env.LATEX_SERVICE_URL;
      if (!latexServiceUrl) {
        throw new Error("LATEX_SERVICE_URL not configured. Required for Overleaf support.");
      }

      const response = await fetchWithTimeout(`${latexServiceUrl}/git/file`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          filePath: args.filePath,
          branch: args.branch,
          auth: credentials,
        }),
        timeout: 60000, // 1 minute for git file
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

    if (isSelfHosted && !matchingInstance) {
      throw new Error(
        `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
        `The instance may have been deleted. Please re-add the repository.`
      );
    }

    const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
    let token: string | null;
    if (parsed.provider === "github") {
      token = args.userId
        ? await getGitHubTokenByUserId(ctx, args.userId)
        : await getGitHubToken(ctx);
    } else if (isSelfHosted) {
      token = matchingInstance!.token;
    } else {
      token = args.userId
        ? await getGitLabTokenByUserId(ctx, args.userId)
        : await getGitLabToken(ctx);
    }

    let rawUrl: string;
    const headers: Record<string, string> = {
      "User-Agent": "Carrel",
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

    const response = await fetchWithTimeout(rawUrl, { headers });

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

// Internal action to fetch file hashes in batch (for multiple files at once)
// Optimizes Overleaf by cloning once for all files instead of once per file
export const fetchFileHashBatchInternal = internalAction({
  args: {
    gitUrl: v.string(),
    filePaths: v.array(v.string()),
    branch: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<Record<string, string | null>> => {
    if (args.filePaths.length === 0) {
      return {};
    }

    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = args.userId
      ? await getAllSelfHostedGitLabInstancesByUserId(ctx, args.userId)
      : await getAllSelfHostedGitLabInstances(ctx);
    const provider = getProviderFromUrl(args.gitUrl, selfHostedInstances);

    // Handle Overleaf projects via latex-service batch endpoint
    if (provider === "overleaf") {
      const overleafParsed = parseOverleafUrl(args.gitUrl);
      if (!overleafParsed) {
        throw new Error(`Invalid Overleaf URL: "${args.gitUrl}"`);
      }

      const credentials = args.userId
        ? await getOverleafCredentialsByUserId(ctx, args.userId)
        : await getOverleafCredentials(ctx);
      if (!credentials) {
        throw new Error("Overleaf credentials not configured.");
      }

      const latexServiceUrl = process.env.LATEX_SERVICE_URL;
      if (!latexServiceUrl) {
        throw new Error("LATEX_SERVICE_URL not configured.");
      }

      // Use latex-service /git/file-hash batch endpoint (single clone for all files)
      const response = await fetchWithTimeout(`${latexServiceUrl}/git/file-hash`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl,
          filePaths: args.filePaths, // Batch request
          branch: args.branch,
          auth: credentials,
        }),
        timeout: 60000, // 1 minute for hash batch
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get file hashes from Overleaf: ${error}`);
      }

      const data = await response.json();
      return data.hashes as Record<string, string | null>;
    }

    // For GitHub/GitLab/Self-hosted: use Promise.all with individual API calls
    // (these are already efficient - 1 HTTP request per file, no git clone)
    const parsed = parseRepoUrl(args.gitUrl, selfHostedInstances);
    if (!parsed) {
      throw new Error("Invalid repository URL.");
    }

    const results: Record<string, string | null> = {};

    if (parsed.provider === "github") {
      const token = args.userId
        ? await getGitHubTokenByUserId(ctx, args.userId)
        : await getGitHubToken(ctx);
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Carrel",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      // Fetch all file hashes in parallel with overall timeout
      const fetchPromises = args.filePaths.map(async (filePath) => {
        try {
          const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
          const response = await fetchWithTimeout(
            `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodedPath}?ref=${encodeURIComponent(args.branch)}`,
            { headers }
          );
          if (!response.ok) {
            return { path: filePath, hash: null };
          }
          const data = await response.json();
          return { path: filePath, hash: data.sha as string };
        } catch {
          return { path: filePath, hash: null };
        }
      });

      const fetchResults = await withTimeout(
        Promise.all(fetchPromises),
        BATCH_OPERATION_TIMEOUT,
        `Batch hash fetch timed out after ${BATCH_OPERATION_TIMEOUT}ms for ${args.filePaths.length} files`
      );
      for (const result of fetchResults) {
        results[result.path] = result.hash;
      }
    } else {
      // GitLab API (both gitlab.com and self-hosted)
      const isSelfHosted = parsed.provider === "selfhosted-gitlab";
      const matchingInstance = isSelfHosted
        ? selfHostedInstances.find((inst) => inst.url === parsed.matchedInstanceUrl)
        : null;

      if (isSelfHosted && !matchingInstance) {
        throw new Error(
          `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
          `The instance may have been deleted. Please re-add the repository.`
        );
      }

      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      let token: string | null;
      if (isSelfHosted) {
        token = matchingInstance!.token;
      } else {
        token = args.userId
          ? await getGitLabTokenByUserId(ctx, args.userId)
          : await getGitLabToken(ctx);
      }
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);

      const headers: Record<string, string> = {
        "User-Agent": "Carrel",
      };
      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }

      // Fetch all file hashes in parallel with overall timeout
      const fetchPromises = args.filePaths.map(async (filePath) => {
        try {
          const encodedFilePath = encodeURIComponent(filePath);
          const response = await fetchWithTimeout(
            `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedFilePath}?ref=${encodeURIComponent(args.branch)}`,
            { headers }
          );
          if (!response.ok) {
            return { path: filePath, hash: null };
          }
          const data = await response.json();
          return { path: filePath, hash: data.blob_id as string };
        } catch {
          return { path: filePath, hash: null };
        }
      });

      const fetchResults = await withTimeout(
        Promise.all(fetchPromises),
        BATCH_OPERATION_TIMEOUT,
        `Batch hash fetch timed out after ${BATCH_OPERATION_TIMEOUT}ms for ${args.filePaths.length} files`
      );
      for (const result of fetchResults) {
        results[result.path] = result.hash;
      }
    }

    return results;
  },
});

// List user's GitHub repositories
export const listUserRepos = action({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const token = await getGitHubToken(ctx);
    if (!token) {
      throw new Error("Not authenticated with GitHub");
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Carrel",
      Authorization: `Bearer ${token}`,
    };

    // Fetch user's repos (includes private repos they have access to)
    const response = await fetchWithTimeout(
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

// List user's GitLab repositories
export const listUserGitLabRepos = action({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const token = await getGitLabToken(ctx);
    if (!token) {
      throw new Error("Not authenticated with GitLab");
    }

    const url = "https://gitlab.com/api/v4/projects?membership=true&order_by=last_activity_at&per_page=100&simple=true";
    const primaryHeaders: Record<string, string> = {
      "User-Agent": "Carrel",
      Authorization: `Bearer ${token}`,
    };

    let response = await fetchWithTimeout(url, { headers: primaryHeaders });
    if (!response.ok && (response.status === 401 || response.status === 403)) {
      const fallbackHeaders: Record<string, string> = {
        "User-Agent": "Carrel",
        "PRIVATE-TOKEN": token,
      };
      response = await fetchWithTimeout(url, { headers: fallbackHeaders });
    }

    if (!response.ok) {
      const errorText = await response.text();
      const detail = errorText ? ` - ${errorText.slice(0, 200)}` : "";
      throw new Error(`GitLab API error: ${response.status} ${response.statusText}${detail}`);
    }

    const data = await response.json();

    return data.map((repo: {
      name: string;
      path_with_namespace: string;
      web_url: string;
      description: string | null;
      visibility: string;
      default_branch: string | null;
      last_activity_at: string;
      avatar_url?: string | null;
    }) => ({
      name: repo.name,
      fullName: repo.path_with_namespace,
      url: repo.web_url,
      description: repo.description,
      isPrivate: repo.visibility !== "public",
      defaultBranch: repo.default_branch || "main",
      updatedAt: repo.last_activity_at,
      ownerAvatar: repo.avatar_url || "",
    }));
  },
});

// Fetch repository info and return default branch (used when adding repos)
export const fetchRepoInfo = action({
  args: { gitUrl: v.string() },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
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

      const response = await fetchWithTimeout(`${latexServiceUrl}/git/refs`, {
        method: "POST",
        headers: getLatexServiceHeaders(),
        body: JSON.stringify({
          gitUrl: overleafParsed.gitUrl, // Use canonical git URL
          auth: credentials,
        }),
        timeout: 30000, // 30 seconds for refs
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
      "User-Agent": "Carrel",
    };

    if (parsed.provider === "github") {
      // Try to get the user's GitHub token for private repo access
      const token = await getGitHubToken(ctx);

      headers["Accept"] = "application/vnd.github.v3+json";
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetchWithTimeout(
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

      if (isSelfHosted && !matchingInstance) {
        throw new Error(
          `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
          `The instance may have been deleted. Please re-add the repository.`
        );
      }

      const baseUrl = isSelfHosted ? matchingInstance!.url : "https://gitlab.com";
      const token = isSelfHosted ? matchingInstance!.token : await getGitLabToken(ctx);
      const projectId = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);

      if (token) {
        headers["PRIVATE-TOKEN"] = token;
      }

      const response = await fetchWithTimeout(
        `${baseUrl}/api/v4/projects/${projectId}`,
        { headers }
      );

      if (!response.ok) {
        if (response.status === 401) {
          if (isSelfHosted) {
            throw new Error(
              `Authentication failed for ${matchingInstance!.name}. ` +
              "Your Personal Access Token may be expired or invalid. " +
              "Please update the token in your self-hosted GitLab settings."
            );
          }
          throw new Error("GitLab authentication failed. Please sign in with GitLab again.");
        }
        if (response.status === 403) {
          if (isSelfHosted) {
            throw new Error(
              `Access denied to ${parsed.owner}/${parsed.repo} on ${matchingInstance!.name}. ` +
              "Your PAT may lack the required scopes (read_api, read_repository) or you may not have access to this project."
            );
          }
          throw new Error(
            `Access denied to ${parsed.owner}/${parsed.repo}. ` +
            "Check that you have permission to view this repository."
          );
        }
        if (response.status === 404) {
          if (isSelfHosted) {
            throw new Error(
              `Repository not found: ${parsed.owner}/${parsed.repo} on ${matchingInstance!.name}. ` +
              "Check that the repository exists and your PAT has access to it."
            );
          }
          const privateNote = token
            ? "Check that you have access to this repository."
            : "If this is a private repository, sign in with GitLab first.";
          throw new Error(
            `Repository not found: ${parsed.owner}/${parsed.repo}. ${privateNote}`
          );
        }
        // For other errors, try to get more detail
        const errorText = await response.text().catch(() => "");
        if (isSelfHosted) {
          throw new Error(
            `Could not access repository on ${matchingInstance!.name} (HTTP ${response.status}). ` +
            (errorText ? errorText.slice(0, 100) : response.statusText)
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

// Test and add a self-hosted GitLab instance
// This action tests the connection before saving to provide better error messages
export const addSelfHostedGitLabInstanceWithTest = action({
  args: {
    name: v.string(),
    url: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Normalize URL (remove trailing slash)
    const normalizedUrl = args.url.replace(/\/$/, "");

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      throw new Error(
        "Invalid URL format. Please enter a valid URL like https://gitlab.example.com"
      );
    }

    // Require HTTPS
    if (parsedUrl.protocol !== "https:") {
      throw new Error(
        "Only HTTPS URLs are allowed for security. Please use https:// instead of http://"
      );
    }

    // Test the connection by fetching the GitLab API version endpoint
    // This is a lightweight endpoint that doesn't require specific scopes
    const headers: Record<string, string> = {
      "User-Agent": "Carrel",
      "PRIVATE-TOKEN": args.token,
    };

    try {
      // First, test basic connectivity with version endpoint
      const versionResponse = await fetchWithTimeout(
        `${normalizedUrl}/api/v4/version`,
        { headers, timeout: 15000 }
      );

      if (versionResponse.status === 401) {
        throw new Error(
          "Authentication failed. Please check that your Personal Access Token is correct and not expired."
        );
      }

      if (versionResponse.status === 403) {
        throw new Error(
          "Access denied. Your token may not have the required scopes. " +
          "Please ensure your PAT has at least 'read_api' scope."
        );
      }

      if (!versionResponse.ok) {
        const errorText = await versionResponse.text().catch(() => "");
        throw new Error(
          `Could not connect to GitLab instance (HTTP ${versionResponse.status}). ` +
          (errorText ? `Server response: ${errorText.slice(0, 100)}` : "Please verify the URL is correct.")
        );
      }

      // Now test that we can actually list projects (verifies read_api scope)
      const projectsResponse = await fetchWithTimeout(
        `${normalizedUrl}/api/v4/projects?membership=true&per_page=1`,
        { headers, timeout: 15000 }
      );

      if (projectsResponse.status === 403) {
        throw new Error(
          "Token is valid but lacks required permissions. " +
          "Please ensure your PAT has 'read_api' and 'read_repository' scopes."
        );
      }

      if (!projectsResponse.ok && projectsResponse.status !== 401) {
        // 401 might just mean the token doesn't have project access yet, which is fine
        const errorText = await projectsResponse.text().catch(() => "");
        throw new Error(
          `Could not verify repository access (HTTP ${projectsResponse.status}). ` +
          (errorText ? `Server response: ${errorText.slice(0, 100)}` : "")
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        // Check for network-level errors
        const message = error.message.toLowerCase();
        if (message.includes("fetch") || message.includes("network") || message.includes("enotfound") || message.includes("econnrefused")) {
          throw new Error(
            `Could not reach the GitLab instance at ${parsedUrl.hostname}. ` +
            "Please check that the URL is correct and the server is accessible."
          );
        }
        if (message.includes("timeout")) {
          throw new Error(
            `Connection timed out while trying to reach ${parsedUrl.hostname}. ` +
            "The server may be slow or unreachable."
          );
        }
        if (message.includes("certificate") || message.includes("ssl") || message.includes("tls")) {
          throw new Error(
            `SSL/TLS error connecting to ${parsedUrl.hostname}. ` +
            "The server may have an invalid or self-signed certificate."
          );
        }
        // Re-throw our own errors
        throw error;
      }
      throw new Error("An unexpected error occurred while testing the connection.");
    }

    // Connection test passed - now save the instance using the mutation
    const { api } = await import("./_generated/api");
    const instanceId = await ctx.runMutation(api.users.addSelfHostedGitLabInstance, {
      name: args.name,
      url: normalizedUrl,
      token: args.token,
    });

    return { instanceId, success: true };
  },
});

import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import type { Id } from "./_generated/dataModel";
import { type SelfHostedGitLabInstance } from "./lib/gitProviders";
import { fetchWithTimeout } from "./lib/http";
import { decryptTokenIfNeeded, encryptTokenIfNeeded } from "./lib/crypto";
import {
  getProvider,
  type TokenGetters,
  type CommitInfo,
  GitLabProvider,
} from "./lib/providers";
import { isGitLabApiError } from "./lib/providers/types";

// Token refresh buffer: refresh 5 minutes before expiry to avoid race conditions
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Safe JSON parsing helper to handle corrupted/HTML responses
async function safeJsonParse<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Log first 200 chars to help debug without exposing full response
    console.error(`JSON parse failed for ${context}: ${text.slice(0, 200)}`);
    throw new Error(`Invalid JSON response from ${context}`);
  }
}

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

async function forceRefreshGitLabTokenByUserId(
  ctx: ActionCtx,
  userId: Id<"users">
): Promise<string | null> {
  const user = await ctx.runQuery(internal.git.getUser, { userId });
  if (!user?.gitlabRefreshToken) return null;
  const decryptedRefreshToken = await decryptTokenIfNeeded(user.gitlabRefreshToken);
  if (!decryptedRefreshToken) return null;
  const refreshed = await refreshGitLabToken(ctx, userId, decryptedRefreshToken);
  return refreshed?.accessToken ?? null;
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

// Create token getters object for use with provider factory
function createTokenGetters(): TokenGetters {
  return {
    getGitHubToken,
    getGitHubTokenByUserId,
    getGitLabToken,
    getGitLabTokenByUserId,
    getOverleafCredentials,
    getOverleafCredentialsByUserId,
  };
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

    const data = await safeJsonParse<{ access_token: string; refresh_token: string; expires_in?: number }>(
      response,
      "GitLab token refresh"
    );
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

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters()
    );

    const info = await provider.fetchRepositoryInfo(owner, repo);
    return {
      name: info.name,
      fullName: info.fullName,
      defaultBranch: info.defaultBranch,
      description: info.description,
      private: info.isPrivate,
    };
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

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters()
    );

    const commit = await provider.fetchLatestCommit(owner, repo, args.branch);
    return {
      sha: commit.sha,
      message: commit.message,
      date: commit.date,
    };
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

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters()
    );

    const arrayBuffer = await provider.fetchFileContent(owner, repo, args.branch, args.filePath);
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
    const branch = args.branch || "main";

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters()
    );

    return provider.listFiles(owner, repo, branch, args.path);
  },
});

// List files in a repository for mobile (internal action, takes userId)
export const listRepositoryFilesInternal = internalAction({
  args: {
    gitUrl: v.string(),
    path: v.optional(v.string()),
    branch: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Get all self-hosted GitLab instances for this user
    const selfHostedInstances = await getAllSelfHostedGitLabInstancesByUserId(ctx, args.userId);
    const branch = args.branch || "main";

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters(),
      args.userId
    );

    return provider.listFiles(owner, repo, branch, args.path);
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

    const authUserId = args.userId ?? await auth.getUserId(ctx);

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters(),
      args.userId
    );

    const formatCommit = (commit: CommitInfo) => {
      if (commit.unchanged) {
        return {
          sha: commit.sha,
          message: commit.message,
          unchanged: true as const,
        };
      }

      // Check if the date is a fallback from the provider, or if we need to use our own fallback
      const dateIsFallback = commit.dateIsFallback || !commit.date;
      return {
        sha: commit.sha,
        message: commit.message,
        date: commit.date || new Date().toISOString(),
        dateIsFallback,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
      };
    };

    try {
      const commit = await provider.fetchLatestCommit(owner, repo, args.branch, args.knownSha);
      return formatCommit(commit);
    } catch (error) {
      const isCloudGitLab = provider.providerName === "gitlab" && provider.baseUrl === "https://gitlab.com";
      const canRetry =
        isCloudGitLab &&
        authUserId &&
        isGitLabApiError(error) &&
        (error.status === 401 || error.status === 403);

      if (!canRetry) {
        throw error;
      }

      const refreshedToken = await forceRefreshGitLabTokenByUserId(ctx, authUserId);
      if (!refreshedToken) {
        throw error;
      }

      console.log("GitLab auth failed, retrying with refreshed token");
      const refreshedProvider = new GitLabProvider(refreshedToken, "https://gitlab.com");
      const retryCommit = await refreshedProvider.fetchLatestCommit(
        owner,
        repo,
        args.branch,
        args.knownSha
      );
      return formatCommit(retryCommit);
    }
  },
});

// Fetch list of files changed between two commits
export const fetchChangedFilesInternal = internalAction({
  args: {
    gitUrl: v.string(),
    baseCommit: v.string(),
    headCommit: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const selfHostedInstances = args.userId
      ? await getAllSelfHostedGitLabInstancesByUserId(ctx, args.userId)
      : await getAllSelfHostedGitLabInstances(ctx);

    try {
      const { provider, owner, repo } = await getProvider(
        ctx,
        args.gitUrl,
        selfHostedInstances,
        createTokenGetters(),
        args.userId
      );

      return provider.fetchChangedFiles(owner, repo, args.baseCommit, args.headCommit);
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

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters(),
      args.userId
    );

    const arrayBuffer = await provider.fetchFileContent(owner, repo, args.branch, args.filePath);
    return {
      content: Array.from(new Uint8Array(arrayBuffer)),
      size: arrayBuffer.byteLength,
    };
  },
});

// Internal action to fetch a file and store it directly to Convex storage
// This avoids the return value size limit by not returning the file content
export const fetchAndStoreFileInternal = internalAction({
  args: {
    gitUrl: v.string(),
    filePath: v.string(),
    branch: v.string(),
    userId: v.optional(v.id("users")),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ storageId: Id<"_storage">; size: number }> => {
    const contentType = args.contentType ?? "application/octet-stream";

    // Get all self-hosted GitLab instances to check if URL matches any
    const selfHostedInstances = args.userId
      ? await getAllSelfHostedGitLabInstancesByUserId(ctx, args.userId)
      : await getAllSelfHostedGitLabInstances(ctx);

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters(),
      args.userId
    );

    const arrayBuffer = await provider.fetchFileContent(owner, repo, args.branch, args.filePath);

    // Store directly to Convex storage
    const blob = new Blob([arrayBuffer], { type: contentType });
    const storageId = await ctx.storage.store(blob);

    return {
      storageId,
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

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters(),
      args.userId
    );

    return provider.fetchFileHashBatch(owner, repo, args.branch, args.filePaths);
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

    const { provider, owner, repo } = await getProvider(
      ctx,
      args.gitUrl,
      selfHostedInstances,
      createTokenGetters()
    );

    const info = await provider.fetchRepositoryInfo(owner, repo);
    return {
      name: info.name,
      defaultBranch: info.defaultBranch,
      isPrivate: info.isPrivate,
    };
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

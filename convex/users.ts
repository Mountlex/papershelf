import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { auth } from "./auth";

async function requireUserId(ctx: Parameters<typeof auth.getUserId>[0]) {
  const userId = await auth.getUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

async function requireDevAdmin(ctx: Parameters<typeof auth.getUserId>[0]) {
  const userId = await requireUserId(ctx);
  if (process.env.ALLOW_DEV_ADMIN !== "true") {
    throw new Error("Admin operation not allowed");
  }
  return userId;
}

// Get the currently authenticated user (returns only non-sensitive fields)
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get(userId);
    if (!user) return null;

    // Return only non-sensitive fields (exclude tokens)
    return {
      _id: user._id,
      _creationTime: user._creationTime,
      name: user.name,
      image: user.image,
      email: user.email,
      emailVerificationTime: user.emailVerificationTime,
      // Boolean flags for credential presence (no actual tokens)
      hasOverleafCredentials: !!(user.overleafEmail && user.overleafToken),
      hasGitHubToken: !!user.githubAccessToken,
      hasGitLabToken: !!user.gitlabAccessToken,
    };
  },
});

// Get user by ID (returns only non-sensitive fields)
export const get = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    // Authorization check: only allow authenticated users to query user info
    // For queries, return null if not authorized (don't throw)
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.id) {
      return null;
    }

    const user = await ctx.db.get(args.id);
    if (!user) return null;

    // Return only non-sensitive fields (exclude tokens)
    return {
      _id: user._id,
      _creationTime: user._creationTime,
      name: user.name,
      image: user.image,
      email: user.email,
    };
  },
});

// Check if the current user has a GitHub token configured (does NOT return the token)
export const hasGitHubToken = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return false;
    }

    // Find the GitHub account linked to this user
    const account = await ctx.db
      .query("authAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("provider"), "github")
        )
      )
      .first();

    return account !== null;
  },
});

// Save Overleaf credentials for the current user
export const saveOverleafCredentials = mutation({
  args: {
    email: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    await ctx.db.patch(userId, {
      overleafEmail: args.email,
      overleafToken: args.token,
    });
  },
});

// Check if the current user has Overleaf credentials configured
export const hasOverleafCredentials = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return false;
    }

    const user = await ctx.db.get(userId);
    return !!(user?.overleafEmail && user?.overleafToken);
  },
});

// Clear Overleaf credentials for the current user
export const clearOverleafCredentials = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    await ctx.db.patch(userId, {
      overleafEmail: undefined,
      overleafToken: undefined,
    });
  },
});

// Check if a URL points to a private/reserved IP range (SSRF protection)
function isPrivateOrReservedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Only allow HTTPS
    if (url.protocol !== "https:") {
      return true;
    }

    // Block localhost
    if (hostname === "localhost" || hostname === "localhost.localdomain") {
      return true;
    }

    // Block loopback (127.x.x.x)
    if (/^127\./.test(hostname)) {
      return true;
    }

    // Block IPv6 loopback
    if (hostname === "::1" || hostname === "[::1]") {
      return true;
    }

    // Block private IPv4 ranges
    // 10.0.0.0/8
    if (/^10\./.test(hostname)) {
      return true;
    }
    // 172.16.0.0/12 (172.16.x.x to 172.31.x.x)
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) {
      return true;
    }
    // 192.168.0.0/16
    if (/^192\.168\./.test(hostname)) {
      return true;
    }
    // 169.254.0.0/16 (link-local)
    if (/^169\.254\./.test(hostname)) {
      return true;
    }
    // 0.0.0.0
    if (hostname === "0.0.0.0") {
      return true;
    }

    // Block internal domains that might point to metadata services
    if (hostname.endsWith(".internal") || hostname.endsWith(".local")) {
      return true;
    }

    // Block cloud metadata endpoints
    if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
      return true;
    }

    return false;
  } catch {
    // Invalid URL
    return true;
  }
}

// Add a new self-hosted GitLab instance for the current user
export const addSelfHostedGitLabInstance = mutation({
  args: {
    name: v.string(),  // User-friendly name, e.g., "Work GitLab"
    url: v.string(),   // e.g., "https://gitlab.mycompany.com"
    token: v.string(), // Personal Access Token
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    // Normalize URL (remove trailing slash)
    const normalizedUrl = args.url.replace(/\/$/, "");

    // SSRF protection: validate URL is not pointing to private/reserved addresses
    if (isPrivateOrReservedUrl(normalizedUrl)) {
      throw new Error("Invalid URL: Only HTTPS URLs to public hosts are allowed. Private IP ranges, localhost, and internal addresses are not permitted.");
    }

    // Check if an instance with this URL already exists for this user
    const existing = await ctx.db
      .query("selfHostedGitLabInstances")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("url"), normalizedUrl))
      .first();

    if (existing) {
      throw new Error("An instance with this URL already exists");
    }

    const instanceId = await ctx.db.insert("selfHostedGitLabInstances", {
      userId,
      name: args.name,
      url: normalizedUrl,
      token: args.token,
      createdAt: Date.now(),
    });

    return instanceId;
  },
});

// Update an existing self-hosted GitLab instance
export const updateSelfHostedGitLabInstance = mutation({
  args: {
    id: v.id("selfHostedGitLabInstances"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const instance = await ctx.db.get(args.id);
    if (!instance || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    const updates: Partial<{ name: string; url: string; token: string }> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.url !== undefined) {
      const normalizedUrl = args.url.replace(/\/$/, "");
      if (isPrivateOrReservedUrl(normalizedUrl)) {
        throw new Error("Invalid URL: Only HTTPS URLs to public hosts are allowed. Private IP ranges, localhost, and internal addresses are not permitted.");
      }
      updates.url = normalizedUrl;
    }
    if (args.token !== undefined) updates.token = args.token;

    await ctx.db.patch(args.id, updates);
  },
});

// Delete a self-hosted GitLab instance
export const deleteSelfHostedGitLabInstance = mutation({
  args: {
    id: v.id("selfHostedGitLabInstances"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const instance = await ctx.db.get(args.id);
    if (!instance || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    await ctx.db.delete(args.id);
  },
});

// Get all self-hosted GitLab instances for the current user
export const getSelfHostedGitLabInstances = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return [];
    }

    const instances = await ctx.db
      .query("selfHostedGitLabInstances")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Return without tokens for security
    return instances.map((inst) => ({
      _id: inst._id,
      name: inst.name,
      url: inst.url,
      createdAt: inst.createdAt,
    }));
  },
});

// Check if the current user has any self-hosted GitLab instances configured
export const hasSelfHostedGitLabInstances = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return false;
    }

    const instance = await ctx.db
      .query("selfHostedGitLabInstances")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    return instance !== null;
  },
});

// Clear GitLab OAuth credentials (clear token to force reauth)
export const clearGitLabCredentials = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    // Clear the token from user record
    await ctx.db.patch(userId, {
      gitlabAccessToken: undefined,
    });

    return { cleared: true };
  },
});

// Clear GitHub OAuth credentials (clear token to force reauth)
export const clearGitHubCredentials = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    // Clear the token from user record
    await ctx.db.patch(userId, {
      githubAccessToken: undefined,
    });

    return { cleared: true };
  },
});

// Check if another user exists with the same email (for merge prompt)
export const hasMergeCandidate = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return false;
    }

    const user = await ctx.db.get(userId);
    if (!user?.email) {
      return false;
    }

    const usersWithEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", user.email))
      .collect();

    return usersWithEmail.some((u) => u._id !== userId);
  },
});

// Merge duplicate accounts by email (e.g., GitHub + GitLab OAuth)
export const mergeAccountsByEmail = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const currentUser = await ctx.db.get(userId);
    if (!currentUser || !currentUser.email) {
      return { merged: false };
    }

    const usersWithEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", currentUser.email))
      .collect();

    const otherUsers = usersWithEmail.filter((u) => u._id !== userId);
    if (otherUsers.length === 0) {
      return { merged: false };
    }

    const primary = usersWithEmail.find((u) => u.githubAccessToken) || currentUser;
    const secondary = primary._id === currentUser._id ? otherUsers[0] : currentUser;

    if (!secondary) {
      return { merged: false };
    }

    const updates: Partial<{
      githubAccessToken: string;
      gitlabAccessToken: string;
      overleafEmail: string;
      overleafToken: string;
    }> = {};

    if (!primary.githubAccessToken && secondary.githubAccessToken) {
      updates.githubAccessToken = secondary.githubAccessToken;
    }
    if (!primary.gitlabAccessToken && secondary.gitlabAccessToken) {
      updates.gitlabAccessToken = secondary.gitlabAccessToken;
    }
    if (!primary.overleafEmail && secondary.overleafEmail) {
      updates.overleafEmail = secondary.overleafEmail;
    }
    if (!primary.overleafToken && secondary.overleafToken) {
      updates.overleafToken = secondary.overleafToken;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(primary._id, updates);
    }

    const authAccounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("userId"), secondary._id))
      .collect();

    for (const account of authAccounts) {
      await ctx.db.patch(account._id, { userId: primary._id });
    }

    const authSessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.eq(q.field("userId"), secondary._id))
      .collect();

    for (const session of authSessions) {
      await ctx.db.patch(session._id, { userId: primary._id });
    }

    const repositories = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", secondary._id))
      .collect();

    for (const repo of repositories) {
      await ctx.db.patch(repo._id, { userId: primary._id });
    }

    const papers = await ctx.db
      .query("papers")
      .withIndex("by_user", (q) => q.eq("userId", secondary._id))
      .collect();

    for (const paper of papers) {
      await ctx.db.patch(paper._id, { userId: primary._id });
    }

    const instances = await ctx.db
      .query("selfHostedGitLabInstances")
      .withIndex("by_user", (q) => q.eq("userId", secondary._id))
      .collect();

    for (const instance of instances) {
      await ctx.db.patch(instance._id, { userId: primary._id });
    }

    await ctx.db.delete(secondary._id);

    return { merged: true, primaryUserId: primary._id };
  },
});

// Link a new OAuth provider to an existing account (for cross-email linking)
export const linkProviderToAccount = mutation({
  args: {
    originalUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Get the current user (the "new" one created by OAuth)
    const currentUserId = await requireUserId(ctx);
    const currentUser = await ctx.db.get(currentUserId);

    if (!currentUser) {
      throw new Error("Current user not found");
    }

    // If the current user IS the original user, nothing to do
    if (currentUserId === args.originalUserId) {
      return { linked: false, reason: "same_user" };
    }

    // Get the original user (the one we want to link to)
    const originalUser = await ctx.db.get(args.originalUserId);
    if (!originalUser) {
      throw new Error("Original user not found");
    }

    // Transfer auth accounts from current user to original user
    const authAccounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("userId"), currentUserId))
      .collect();

    for (const account of authAccounts) {
      await ctx.db.patch(account._id, { userId: args.originalUserId });
    }

    // Copy provider tokens from current user to original user
    // Always overwrite with the new token (it's fresher from OAuth)
    const tokenUpdates: Partial<{
      githubAccessToken: string;
      gitlabAccessToken: string;
      overleafEmail: string;
      overleafToken: string;
    }> = {};

    if (currentUser.githubAccessToken) {
      tokenUpdates.githubAccessToken = currentUser.githubAccessToken;
    }
    if (currentUser.gitlabAccessToken) {
      tokenUpdates.gitlabAccessToken = currentUser.gitlabAccessToken;
    }
    if (currentUser.overleafEmail) {
      tokenUpdates.overleafEmail = currentUser.overleafEmail;
    }
    if (currentUser.overleafToken) {
      tokenUpdates.overleafToken = currentUser.overleafToken;
    }

    if (Object.keys(tokenUpdates).length > 0) {
      await ctx.db.patch(args.originalUserId, tokenUpdates);
    }

    // Transfer repositories from current user to original user
    const repositories = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", currentUserId))
      .collect();

    for (const repo of repositories) {
      await ctx.db.patch(repo._id, { userId: args.originalUserId });
    }

    // Transfer papers from current user to original user
    const papers = await ctx.db
      .query("papers")
      .withIndex("by_user", (q) => q.eq("userId", currentUserId))
      .collect();

    for (const paper of papers) {
      await ctx.db.patch(paper._id, { userId: args.originalUserId });
    }

    // Transfer self-hosted GitLab instances
    const instances = await ctx.db
      .query("selfHostedGitLabInstances")
      .withIndex("by_user", (q) => q.eq("userId", currentUserId))
      .collect();

    for (const instance of instances) {
      await ctx.db.patch(instance._id, { userId: args.originalUserId });
    }

    // Transfer sessions from current (duplicate) user to original user
    // This keeps the user logged in after the link completes
    const sessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.eq(q.field("userId"), currentUserId))
      .collect();

    for (const session of sessions) {
      await ctx.db.patch(session._id, { userId: args.originalUserId });
    }

    // Delete the duplicate user
    await ctx.db.delete(currentUserId);

    return { linked: true, originalUserId: args.originalUserId };
  },
});

// Admin: Clear ALL GitLab OAuth data (for dev/debugging)
export const adminClearAllGitLabData = mutation({
  args: {},
  handler: async (ctx) => {
    await requireDevAdmin(ctx);
    // Delete all GitLab auth accounts
    const gitlabAccounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("provider"), "gitlab"))
      .collect();

    for (const account of gitlabAccounts) {
      await ctx.db.delete(account._id);
    }

    // Clear gitlabAccessToken from all users
    const users = await ctx.db.query("users").collect();
    for (const user of users) {
      if (user.gitlabAccessToken) {
        await ctx.db.patch(user._id, { gitlabAccessToken: undefined });
      }
    }

    return { deletedAccounts: gitlabAccounts.length };
  },
});

// Admin: Merge GitLab account into GitHub account
export const adminMergeGitLabIntoGitHub = mutation({
  args: {
    gitlabUserId: v.id("users"),
    githubUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireDevAdmin(ctx);
    // Get both users
    const gitlabUser = await ctx.db.get(args.gitlabUserId);
    const githubUser = await ctx.db.get(args.githubUserId);

    if (!gitlabUser || !githubUser) {
      throw new Error("One or both users not found");
    }

    // Move GitLab token to GitHub user
    await ctx.db.patch(args.githubUserId, {
      gitlabAccessToken: gitlabUser.gitlabAccessToken,
    });

    // Update the GitLab authAccount to point to GitHub user
    const gitlabAccount = await ctx.db
      .query("authAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.gitlabUserId),
          q.eq(q.field("provider"), "gitlab")
        )
      )
      .first();

    if (gitlabAccount) {
      await ctx.db.patch(gitlabAccount._id, {
        userId: args.githubUserId,
      });
    }

    // Delete any sessions for the GitLab user
    const gitlabSessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.eq(q.field("userId"), args.gitlabUserId))
      .collect();

    for (const session of gitlabSessions) {
      await ctx.db.delete(session._id);
    }

    // Delete the duplicate GitLab-only user
    await ctx.db.delete(args.gitlabUserId);

    return { success: true };
  },
});

// Admin: Clear ALL data (for dev/testing)
export const adminClearAllData = mutation({
  args: {},
  handler: async (ctx) => {
    await requireDevAdmin(ctx);

    const counts: Record<string, number> = {};

    // Clear compilationJobs
    const jobs = await ctx.db.query("compilationJobs").collect();
    for (const job of jobs) await ctx.db.delete(job._id);
    counts.compilationJobs = jobs.length;

    // Clear papers
    const papers = await ctx.db.query("papers").collect();
    for (const paper of papers) await ctx.db.delete(paper._id);
    counts.papers = papers.length;

    // Clear trackedFiles
    const files = await ctx.db.query("trackedFiles").collect();
    for (const file of files) await ctx.db.delete(file._id);
    counts.trackedFiles = files.length;

    // Clear repositories
    const repos = await ctx.db.query("repositories").collect();
    for (const repo of repos) await ctx.db.delete(repo._id);
    counts.repositories = repos.length;

    // Clear selfHostedGitLabInstances
    const instances = await ctx.db.query("selfHostedGitLabInstances").collect();
    for (const inst of instances) await ctx.db.delete(inst._id);
    counts.selfHostedGitLabInstances = instances.length;

    // Clear authSessions
    const sessions = await ctx.db.query("authSessions").collect();
    for (const session of sessions) await ctx.db.delete(session._id);
    counts.authSessions = sessions.length;

    // Clear authAccounts
    const accounts = await ctx.db.query("authAccounts").collect();
    for (const account of accounts) await ctx.db.delete(account._id);
    counts.authAccounts = accounts.length;

    // Clear authRefreshTokens
    const refreshTokens = await ctx.db.query("authRefreshTokens").collect();
    for (const token of refreshTokens) await ctx.db.delete(token._id);
    counts.authRefreshTokens = refreshTokens.length;

    // Clear authVerificationCodes
    const codes = await ctx.db.query("authVerificationCodes").collect();
    for (const code of codes) await ctx.db.delete(code._id);
    counts.authVerificationCodes = codes.length;

    // Clear authVerifiers
    const verifiers = await ctx.db.query("authVerifiers").collect();
    for (const verifier of verifiers) await ctx.db.delete(verifier._id);
    counts.authVerifiers = verifiers.length;

    // Clear authRateLimits
    const rateLimits = await ctx.db.query("authRateLimits").collect();
    for (const limit of rateLimits) await ctx.db.delete(limit._id);
    counts.authRateLimits = rateLimits.length;

    // Clear users
    const users = await ctx.db.query("users").collect();
    for (const user of users) await ctx.db.delete(user._id);
    counts.users = users.length;

    return { cleared: true, counts };
  },
});

// Internal query to get user by email (for mobile auth token issuance)
export const getUserByEmail = internalQuery({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    return user;
  },
});

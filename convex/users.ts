import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { auth } from "./auth";

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
    if (!authenticatedUserId) {
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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const instance = await ctx.db.get(args.id);
    if (!instance || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    const updates: Partial<{ name: string; url: string; token: string }> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.url !== undefined) updates.url = args.url.replace(/\/$/, "");
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
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

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

// Clear GitLab OAuth credentials (delete auth account and token)
export const clearGitLabCredentials = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Delete GitLab auth accounts for this user
    const gitlabAccounts = await ctx.db
      .query("authAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("provider"), "gitlab")
        )
      )
      .collect();

    for (const account of gitlabAccounts) {
      await ctx.db.delete(account._id);
    }

    // Clear the token from user record
    await ctx.db.patch(userId, {
      gitlabAccessToken: undefined,
    });

    return { deleted: gitlabAccounts.length };
  },
});

// Admin: Clear ALL GitLab OAuth data (for dev/debugging)
export const adminClearAllGitLabData = mutation({
  args: {},
  handler: async (ctx) => {
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



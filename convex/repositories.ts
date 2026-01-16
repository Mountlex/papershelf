import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// List all repositories for a user
export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// Get a single repository by ID
export const get = query({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get repository with tracked files
export const getWithTrackedFiles = query({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.id);
    if (!repository) return null;

    const trackedFiles = await ctx.db
      .query("trackedFiles")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.id))
      .collect();

    return { ...repository, trackedFiles };
  },
});

// Parse GitHub URL to extract owner and repo name
function parseGitUrl(url: string): { owner: string; repo: string; provider: "github" | "gitlab" | "overleaf" | "generic" } {
  // GitHub: https://github.com/owner/repo or git@github.com:owner/repo.git
  const githubMatch = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
  if (githubMatch) {
    return { owner: githubMatch[1], repo: githubMatch[2], provider: "github" };
  }

  // GitLab: https://gitlab.com/owner/repo
  const gitlabMatch = url.match(/gitlab\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
  if (gitlabMatch) {
    return { owner: gitlabMatch[1], repo: gitlabMatch[2], provider: "gitlab" };
  }

  // Overleaf: https://git.overleaf.com/project-id
  const overleafMatch = url.match(/overleaf\.com\/([\w]+)/);
  if (overleafMatch) {
    return { owner: "overleaf", repo: overleafMatch[1], provider: "overleaf" };
  }

  // Generic git URL
  const genericMatch = url.match(/\/([\w.-]+?)(\.git)?$/);
  if (genericMatch) {
    return { owner: "unknown", repo: genericMatch[1], provider: "generic" };
  }

  throw new Error("Invalid git URL");
}

// Add a new repository
export const add = mutation({
  args: {
    userId: v.id("users"),
    gitUrl: v.string(),
    name: v.optional(v.string()),
    defaultBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const parsed = parseGitUrl(args.gitUrl);

    const repositoryId = await ctx.db.insert("repositories", {
      userId: args.userId,
      name: args.name || parsed.repo,
      gitUrl: args.gitUrl,
      provider: parsed.provider,
      defaultBranch: args.defaultBranch || "main",
      syncStatus: "idle",
    });

    return repositoryId;
  },
});

// Update repository
export const update = mutation({
  args: {
    id: v.id("repositories"),
    name: v.optional(v.string()),
    defaultBranch: v.optional(v.string()),
    syncStatus: v.optional(
      v.union(v.literal("idle"), v.literal("syncing"), v.literal("error"))
    ),
    lastSyncedAt: v.optional(v.number()),
    lastCommitHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    // Filter out undefined values
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(id, filteredUpdates);
  },
});

// Delete repository and all associated data
export const remove = mutation({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    // Delete tracked files
    const trackedFiles = await ctx.db
      .query("trackedFiles")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.id))
      .collect();

    for (const file of trackedFiles) {
      // Delete papers associated with tracked files
      const papers = await ctx.db
        .query("papers")
        .withIndex("by_tracked_file", (q) => q.eq("trackedFileId", file._id))
        .collect();

      for (const paper of papers) {
        await ctx.db.delete(paper._id);
      }

      await ctx.db.delete(file._id);
    }

    // Delete the repository
    await ctx.db.delete(args.id);
  },
});

// Add tracked file to repository
export const addTrackedFile = mutation({
  args: {
    repositoryId: v.id("repositories"),
    filePath: v.string(),
    fileType: v.union(v.literal("tex"), v.literal("pdf")),
    pdfSourceType: v.union(
      v.literal("committed"),
      v.literal("artifact"),
      v.literal("release"),
      v.literal("compile")
    ),
    artifactPattern: v.optional(v.string()),
    releasePattern: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trackedFileId = await ctx.db.insert("trackedFiles", {
      repositoryId: args.repositoryId,
      filePath: args.filePath,
      fileType: args.fileType,
      pdfSourceType: args.pdfSourceType,
      artifactPattern: args.artifactPattern,
      releasePattern: args.releasePattern,
      isActive: true,
    });

    // Create a paper entry for this tracked file
    const repo = await ctx.db.get(args.repositoryId);
    if (repo) {
      // Extract title from file path (e.g., "paper/main.tex" -> "main")
      const fileName = args.filePath.split("/").pop() || args.filePath;
      const title = fileName.replace(/\.(tex|pdf)$/, "");

      await ctx.db.insert("papers", {
        repositoryId: args.repositoryId,
        trackedFileId: trackedFileId,
        title: title,
        isPublic: false,
        updatedAt: Date.now(),
      });
    }

    return trackedFileId;
  },
});

// Remove tracked file
export const removeTrackedFile = mutation({
  args: { id: v.id("trackedFiles") },
  handler: async (ctx, args) => {
    // Delete associated papers
    const papers = await ctx.db
      .query("papers")
      .withIndex("by_tracked_file", (q) => q.eq("trackedFileId", args.id))
      .collect();

    for (const paper of papers) {
      await ctx.db.delete(paper._id);
    }

    await ctx.db.delete(args.id);
  },
});

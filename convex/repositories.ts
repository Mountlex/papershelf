import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";
import { validateFilePath } from "./lib/validation";
import { parseRepoUrl } from "./lib/gitProviders";

// List all repositories for a user (with sync status)
export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this userId
    // For queries, return empty array if not authorized (don't throw)
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.userId) {
      return [];
    }

    const repositories = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Enrich with sync status based on papers
    const enrichedRepos = await Promise.all(
      repositories.map(async (repo) => {
        // Get papers for this repository
        const papers = await ctx.db
          .query("papers")
          .withIndex("by_repository", (q) => q.eq("repositoryId", repo._id))
          .collect();

        // Determine sync status:
        // - "no_papers" if no papers are tracked
        // - "in_sync" if all papers have needsSync=false and have pdfFileId
        // - "needs_sync" if any paper needs syncing
        // - "never_synced" if repo has no lastCommitHash yet
        let paperSyncStatus: "no_papers" | "in_sync" | "needs_sync" | "never_synced" = "no_papers";

        if (papers.length === 0) {
          paperSyncStatus = "no_papers";
        } else if (!repo.lastCommitHash) {
          paperSyncStatus = "never_synced";
        } else {
          // Check if all papers are in sync
          // A paper is in sync if it has a PDF and either:
          // - needsSync is explicitly false, OR
          // - needsSync is undefined and cachedCommitHash matches (fallback for existing papers)
          const allInSync = papers.every((paper) => {
            if (!paper.pdfFileId) return false;
            if (paper.needsSync === true) return false;
            if (paper.needsSync === false) return true;
            // Fallback for papers without needsSync set
            return paper.cachedCommitHash === repo.lastCommitHash;
          });
          paperSyncStatus = allInSync ? "in_sync" : "needs_sync";
        }

        // Count papers with errors
        const papersWithErrors = papers.filter((p) => p.lastSyncError).length;

        return {
          ...repo,
          paperSyncStatus,
          paperCount: papers.length,
          papersWithErrors,
        };
      })
    );

    return enrichedRepos;
  },
});

// Get a single repository by ID
export const get = query({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this repository
    // For queries, return null if not authorized (don't throw)
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      return null;
    }
    const repository = await ctx.db.get(args.id);
    if (!repository || repository.userId !== authenticatedUserId) {
      return null;
    }
    return repository;
  },
});

// Get repository with tracked files
export const getWithTrackedFiles = query({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this repository
    // For queries, return null if not authorized (don't throw)
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      return null;
    }
    const repository = await ctx.db.get(args.id);
    if (!repository || repository.userId !== authenticatedUserId) {
      return null;
    }

    const trackedFiles = await ctx.db
      .query("trackedFiles")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.id))
      .collect();

    return { ...repository, trackedFiles };
  },
});

// Add a new repository
export const add = mutation({
  args: {
    userId: v.id("users"),
    gitUrl: v.string(),
    name: v.optional(v.string()),
    defaultBranch: v.optional(v.string()),
    selfHostedGitLabInstanceId: v.optional(v.id("selfHostedGitLabInstances")),
  },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this userId
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.userId) {
      throw new Error("Unauthorized");
    }

    // Validate URL format
    try {
      const urlObj = new URL(args.gitUrl);
      if (!["https:", "http:"].includes(urlObj.protocol)) {
        throw new Error("Invalid git URL: Only HTTP(S) URLs are supported");
      }
    } catch {
      throw new Error("Invalid git URL format");
    }

    // Get user's self-hosted GitLab instances to properly detect provider
    const selfHostedInstances = await ctx.db
      .query("selfHostedGitLabInstances")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const parsed = parseRepoUrl(
      args.gitUrl,
      selfHostedInstances.map((i) => ({ url: i.url }))
    );
    if (!parsed) {
      throw new Error("Invalid git URL. Supported providers: GitHub, GitLab, Overleaf, or configured self-hosted GitLab instances.");
    }

    // For self-hosted GitLab, find the matching instance ID
    let instanceId = args.selfHostedGitLabInstanceId;
    if (parsed.provider === "selfhosted-gitlab" && !instanceId && parsed.matchedInstanceUrl) {
      const matchingInstance = selfHostedInstances.find(
        (i) => i.url === parsed.matchedInstanceUrl
      );
      if (matchingInstance) {
        instanceId = matchingInstance._id;
      }
    }

    // Validate that self-hosted GitLab repos have a valid instance
    if (parsed.provider === "selfhosted-gitlab" && !instanceId) {
      throw new Error(
        "Could not find a matching self-hosted GitLab instance for this URL. " +
        "Please add the GitLab instance first in the Self-Hosted tab."
      );
    }

    const repositoryId = await ctx.db.insert("repositories", {
      userId: args.userId,
      name: args.name || parsed.repo,
      gitUrl: args.gitUrl,
      provider: parsed.provider,
      selfHostedGitLabInstanceId: instanceId,
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
    // Authorization check: verify the caller owns this repository
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    const repository = await ctx.db.get(args.id);
    if (!repository || repository.userId !== authenticatedUserId) {
      throw new Error("Unauthorized");
    }

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
    // Authorization check: verify the caller owns this repository
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    const repository = await ctx.db.get(args.id);
    if (!repository || repository.userId !== authenticatedUserId) {
      throw new Error("Unauthorized");
    }

    // Helper to delete a paper and all its associated data
    const deletePaperAndAssociatedData = async (paper: {
      _id: typeof args.id;
      pdfFileId?: string;
      thumbnailFileId?: string;
    }) => {
      // Delete version history and their storage files
      const versions = await ctx.db
        .query("paperVersions")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();

      for (const version of versions) {
        if (version.pdfFileId) {
          await ctx.storage.delete(version.pdfFileId);
        }
        if (version.thumbnailFileId) {
          await ctx.storage.delete(version.thumbnailFileId);
        }
        await ctx.db.delete(version._id);
      }

      // Delete compilation jobs
      const jobs = await ctx.db
        .query("compilationJobs")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();
      for (const job of jobs) {
        await ctx.db.delete(job._id);
      }

      // Delete paper's storage files
      if (paper.pdfFileId) {
        await ctx.storage.delete(paper.pdfFileId as Id<"_storage">);
      }
      if (paper.thumbnailFileId) {
        await ctx.storage.delete(paper.thumbnailFileId as Id<"_storage">);
      }

      await ctx.db.delete(paper._id);
    };

    // Delete all papers associated with this repository (by repositoryId index)
    const papers = await ctx.db
      .query("papers")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.id))
      .collect();

    for (const paper of papers) {
      await deletePaperAndAssociatedData(paper);
    }

    // Delete all tracked files for this repository
    const trackedFiles = await ctx.db
      .query("trackedFiles")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.id))
      .collect();

    for (const file of trackedFiles) {
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
      v.literal("compile")
    ),
  },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this repository
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== authenticatedUserId) {
      throw new Error("Unauthorized");
    }

    // Validate file path (prevents path traversal attacks)
    const filePathValidation = validateFilePath(args.filePath);
    if (!filePathValidation.valid) {
      throw new Error(filePathValidation.error);
    }

    const trackedFileId = await ctx.db.insert("trackedFiles", {
      repositoryId: args.repositoryId,
      filePath: filePathValidation.normalized, // Use normalized path
      fileType: args.fileType,
      pdfSourceType: args.pdfSourceType,
      isActive: true,
    });

    // Create a paper entry for this tracked file
    const repo = await ctx.db.get(args.repositoryId);
    if (repo) {
      // Extract title from file path (e.g., "paper/main.tex" -> "main")
      const fileName = filePathValidation.normalized.split("/").pop() || filePathValidation.normalized;
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
    // Authorization check: verify the caller owns this tracked file's repository
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    const trackedFile = await ctx.db.get(args.id);
    if (!trackedFile) {
      throw new Error("Tracked file not found");
    }
    const repository = await ctx.db.get(trackedFile.repositoryId);
    if (!repository || repository.userId !== authenticatedUserId) {
      throw new Error("Unauthorized");
    }

    // Delete associated papers
    const papers = await ctx.db
      .query("papers")
      .withIndex("by_tracked_file", (q) => q.eq("trackedFileId", args.id))
      .collect();

    for (const paper of papers) {
      // Delete version history and their storage files
      const versions = await ctx.db
        .query("paperVersions")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();

      for (const version of versions) {
        if (version.pdfFileId) {
          await ctx.storage.delete(version.pdfFileId);
        }
        if (version.thumbnailFileId) {
          await ctx.storage.delete(version.thumbnailFileId);
        }
        await ctx.db.delete(version._id);
      }

      // Delete compilation jobs
      const jobs = await ctx.db
        .query("compilationJobs")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();
      for (const job of jobs) {
        await ctx.db.delete(job._id);
      }

      // Delete paper's storage files
      if (paper.pdfFileId) {
        await ctx.storage.delete(paper.pdfFileId);
      }
      if (paper.thumbnailFileId) {
        await ctx.storage.delete(paper.thumbnailFileId);
      }

      await ctx.db.delete(paper._id);
    }

    await ctx.db.delete(args.id);
  },
});

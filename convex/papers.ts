import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { auth } from "./auth";

// List all papers for a user (via repositories + direct uploads)
export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this userId
    // For queries, return empty array if not authorized (don't throw)
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.userId) {
      return [];
    }

    // Get user's repositories
    const repositories = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const repoIds = repositories.map((r) => r._id);

    // Get papers for all repositories
    const papers = [];
    for (const repoId of repoIds) {
      const repoPapers = await ctx.db
        .query("papers")
        .withIndex("by_repository", (q) => q.eq("repositoryId", repoId))
        .collect();
      papers.push(...repoPapers);
    }

    // Also get directly uploaded papers (no repository)
    const directUploads = await ctx.db
      .query("papers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    papers.push(...directUploads);

    // Enrich with thumbnail URLs, repository info, and up-to-date status
    const enrichedPapers = await Promise.all(
      papers.map(async (paper) => {
        const repository = paper.repositoryId
          ? repositories.find((r) => r._id === paper.repositoryId)
          : null;
        const trackedFile = paper.trackedFileId
          ? await ctx.db.get(paper.trackedFileId)
          : null;
        const thumbnailUrl = paper.thumbnailFileId
          ? await ctx.storage.getUrl(paper.thumbnailFileId)
          : null;
        const pdfUrl = paper.pdfFileId
          ? await ctx.storage.getUrl(paper.pdfFileId)
          : null;

        // Determine if paper is up-to-date with repository
        // null = no repository (uploaded PDF), true = up-to-date, false = needs sync
        let isUpToDate: boolean | null = null;
        if (paper.repositoryId && repository) {
          if (!paper.cachedCommitHash || !paper.pdfFileId) {
            // Paper has repo but hasn't been synced yet
            isUpToDate = false;
          } else if (repository.lastCommitHash) {
            // Compare commit hashes
            isUpToDate = paper.cachedCommitHash === repository.lastCommitHash;
          } else {
            // Repository hasn't been synced yet
            isUpToDate = false;
          }
        }

        return {
          ...paper,
          thumbnailUrl,
          pdfUrl,
          isUpToDate,
          pdfSourceType: trackedFile?.pdfSourceType ?? null,
          repository: repository
            ? {
                _id: repository._id,
                name: repository.name,
                lastSyncedAt: repository.lastSyncedAt,
                lastCommitTime: repository.lastCommitTime,
              }
            : null,
        };
      })
    );

    // Sort by updatedAt descending
    return enrichedPapers.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

// Get public papers (for gallery)
export const listPublic = query({
  handler: async (ctx) => {
    const papers = await ctx.db
      .query("papers")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .collect();

    const enrichedPapers = await Promise.all(
      papers.map(async (paper) => {
        const thumbnailUrl = paper.thumbnailFileId
          ? await ctx.storage.getUrl(paper.thumbnailFileId)
          : null;

        return {
          ...paper,
          thumbnailUrl,
        };
      })
    );

    return enrichedPapers.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

// Get a single paper by ID
export const get = query({
  args: { id: v.id("papers") },
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.id);
    if (!paper) return null;

    const repository = paper.repositoryId
      ? await ctx.db.get(paper.repositoryId)
      : null;
    const trackedFile = paper.trackedFileId
      ? await ctx.db.get(paper.trackedFileId)
      : null;
    const thumbnailUrl = paper.thumbnailFileId
      ? await ctx.storage.getUrl(paper.thumbnailFileId)
      : null;
    const pdfUrl = paper.pdfFileId
      ? await ctx.storage.getUrl(paper.pdfFileId)
      : null;

    // Determine if paper is up-to-date with repository
    let isUpToDate: boolean | null = null;
    if (paper.repositoryId && repository) {
      if (!paper.cachedCommitHash || !paper.pdfFileId) {
        isUpToDate = false;
      } else if (repository.lastCommitHash) {
        isUpToDate = paper.cachedCommitHash === repository.lastCommitHash;
      } else {
        isUpToDate = false;
      }
    }

    return {
      ...paper,
      thumbnailUrl,
      pdfUrl,
      isUpToDate,
      repository,
      trackedFile,
    };
  },
});

// Get paper by share slug (for public pages)
export const getByShareSlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const paper = await ctx.db
      .query("papers")
      .withIndex("by_share_slug", (q) => q.eq("shareSlug", args.slug))
      .first();

    if (!paper || !paper.isPublic) return null;

    const thumbnailUrl = paper.thumbnailFileId
      ? await ctx.storage.getUrl(paper.thumbnailFileId)
      : null;
    const pdfUrl = paper.pdfFileId
      ? await ctx.storage.getUrl(paper.pdfFileId)
      : null;

    return {
      ...paper,
      thumbnailUrl,
      pdfUrl,
    };
  },
});

// Update paper metadata
export const update = mutation({
  args: {
    id: v.id("papers"),
    title: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
    abstract: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this paper
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    const paper = await ctx.db.get(args.id);
    if (!paper) {
      throw new Error("Paper not found");
    }
    // Paper is owned directly (userId) or via repository
    if (paper.userId && paper.userId !== authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    if (paper.repositoryId) {
      const repository = await ctx.db.get(paper.repositoryId);
      if (!repository || repository.userId !== authenticatedUserId) {
        throw new Error("Unauthorized");
      }
    }

    const { id, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(id, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });
  },
});

// Generate a share slug
function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  return `${base}-${randomSuffix}`;
}

// Toggle public/private and generate share slug
export const togglePublic = mutation({
  args: { id: v.id("papers") },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this paper
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    const paper = await ctx.db.get(args.id);
    if (!paper) throw new Error("Paper not found");

    // Paper is owned directly (userId) or via repository
    if (paper.userId && paper.userId !== authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    if (paper.repositoryId) {
      const repository = await ctx.db.get(paper.repositoryId);
      if (!repository || repository.userId !== authenticatedUserId) {
        throw new Error("Unauthorized");
      }
    }

    const isPublic = !paper.isPublic;
    const shareSlug = isPublic && !paper.shareSlug ? generateSlug(paper.title) : paper.shareSlug;

    await ctx.db.patch(args.id, {
      isPublic,
      shareSlug,
      updatedAt: Date.now(),
    });

    return { isPublic, shareSlug };
  },
});

// Update paper with cached PDF info
export const updatePdfCache = mutation({
  args: {
    id: v.id("papers"),
    pdfFileId: v.optional(v.id("_storage")),
    thumbnailFileId: v.optional(v.id("_storage")),
    cachedCommitHash: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(id, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });
  },
});

// Generate upload URL for PDF storage
export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Add a tracked file and create a paper for it
export const addTrackedFile = mutation({
  args: {
    repositoryId: v.id("repositories"),
    filePath: v.string(),
    title: v.string(),
    pdfSourceType: v.union(
      v.literal("committed"),
      v.literal("artifact"),
      v.literal("release"),
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

    // Determine file type from extension
    const fileType = args.filePath.endsWith(".pdf") ? "pdf" : "tex";

    // Create tracked file
    const trackedFileId = await ctx.db.insert("trackedFiles", {
      repositoryId: args.repositoryId,
      filePath: args.filePath,
      fileType: fileType as "tex" | "pdf",
      pdfSourceType: args.pdfSourceType,
      isActive: true,
    });

    // Create paper
    const paperId = await ctx.db.insert("papers", {
      repositoryId: args.repositoryId,
      trackedFileId,
      title: args.title,
      isPublic: false,
      updatedAt: Date.now(),
    });

    return { trackedFileId, paperId };
  },
});

// List tracked files for a repository
export const listTrackedFiles = query({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this repository
    // For queries, return empty array if not authorized (don't throw)
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      return [];
    }
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== authenticatedUserId) {
      return [];
    }

    const trackedFiles = await ctx.db
      .query("trackedFiles")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    // Get associated papers
    const filesWithPapers = await Promise.all(
      trackedFiles.map(async (file) => {
        const paper = await ctx.db
          .query("papers")
          .withIndex("by_tracked_file", (q) => q.eq("trackedFileId", file._id))
          .first();
        return { ...file, paper };
      })
    );

    return filesWithPapers;
  },
});

// Remove a tracked file and its paper
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

    // Find and delete associated paper
    const paper = await ctx.db
      .query("papers")
      .withIndex("by_tracked_file", (q) => q.eq("trackedFileId", args.id))
      .first();

    if (paper) {
      // Delete stored files
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

// Internal mutation to update compilation progress (called from actions)
export const updateCompilationProgress = internalMutation({
  args: {
    paperId: v.id("papers"),
    progress: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, {
      compilationProgress: args.progress ?? undefined,
    });
  },
});

// Upload a PDF directly (no repository)
export const uploadPdf = mutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    pdfStorageId: v.id("_storage"),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this userId
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.userId) {
      throw new Error("Unauthorized");
    }

    const paperId = await ctx.db.insert("papers", {
      userId: args.userId,
      title: args.title,
      pdfFileId: args.pdfStorageId,
      fileSize: args.fileSize,
      isPublic: false,
      updatedAt: Date.now(),
    });

    return paperId;
  },
});

// Delete a paper (including uploaded ones)
export const deletePaper = mutation({
  args: { id: v.id("papers") },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this paper
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    const paper = await ctx.db.get(args.id);
    if (!paper) throw new Error("Paper not found");

    // Paper is owned directly (userId) or via repository
    if (paper.userId && paper.userId !== authenticatedUserId) {
      throw new Error("Unauthorized");
    }
    if (paper.repositoryId) {
      const repository = await ctx.db.get(paper.repositoryId);
      if (!repository || repository.userId !== authenticatedUserId) {
        throw new Error("Unauthorized");
      }
    }

    // Delete stored files
    if (paper.pdfFileId) {
      await ctx.storage.delete(paper.pdfFileId);
    }
    if (paper.thumbnailFileId) {
      await ctx.storage.delete(paper.thumbnailFileId);
    }

    await ctx.db.delete(args.id);
  },
});

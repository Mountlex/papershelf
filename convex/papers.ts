import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// List all papers for a user (via repositories)
export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
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

    // Enrich with thumbnail URLs and repository info
    const enrichedPapers = await Promise.all(
      papers.map(async (paper) => {
        const repository = repositories.find((r) => r._id === paper.repositoryId);
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
          repository: repository
            ? { _id: repository._id, name: repository.name }
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

    const repository = await ctx.db.get(paper.repositoryId);
    const trackedFile = await ctx.db.get(paper.trackedFileId);
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
    const paper = await ctx.db.get(args.id);
    if (!paper) throw new Error("Paper not found");

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

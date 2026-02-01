import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { auth } from "./auth";
import { validateFilePath, validatePaperFieldsOrThrow, validateTitleOrThrow } from "./lib/validation";
import type { Id } from "./_generated/dataModel";
import { determineIfUpToDate, generateSlug, fetchPaperWithAuth, fetchUserPapers, fetchUserPapersBase, sortPapersByTime } from "./lib/paperHelpers";
import { deletePaperAndAssociatedData } from "./lib/cascadeDelete";

// List all papers for a user (via repositories + direct uploads)
export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this userId
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.userId) {
      return [];
    }

    const { papers } = await fetchUserPapers(ctx, args.userId);

    // Transform to desktop-specific format with repository details
    const enrichedPapers = papers.map(({ paper, repository, trackedFile, thumbnailUrl, pdfUrl, isUpToDate }) => ({
      _id: paper._id,
      _creationTime: paper._creationTime,
      title: paper.title,
      authors: paper.authors,
      thumbnailUrl,
      pdfUrl,
      isUpToDate,
      pdfSourceType: trackedFile?.pdfSourceType ?? null,
      buildStatus: paper.buildStatus,
      compilationProgress: paper.compilationProgress,
      lastSyncError: paper.lastSyncError,
      isPublic: paper.isPublic,
      lastAffectedCommitTime: paper.lastAffectedCommitTime,
      updatedAt: paper.updatedAt,
      repository: repository
        ? {
            _id: repository._id,
            name: repository.name,
            gitUrl: repository.gitUrl,
            provider: repository.provider,
            lastSyncedAt: repository.lastSyncedAt,
            lastCommitTime: repository.lastCommitTime,
            syncStatus: repository.syncStatus,
          }
        : null,
    }));

    return sortPapersByTime(enrichedPapers);
  },
});

// List all papers for the currently authenticated user (for mobile/SDK)
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    console.log("papers:listMine - userId:", userId);
    if (!userId) {
      console.log("papers:listMine - No authenticated user");
      return [];
    }

    const { papers } = await fetchUserPapers(ctx, userId);
    console.log("papers:listMine - Found", papers.length, "papers for user", userId);

    // Transform to format expected by mobile app
    return sortPapersByTime(papers.map(({ paper, repository, trackedFile, thumbnailUrl, pdfUrl, isUpToDate }) => ({
      _id: paper._id,
      _creationTime: paper._creationTime,
      title: paper.title,
      authors: paper.authors,
      thumbnailUrl,
      pdfUrl,
      isUpToDate,
      buildStatus: paper.buildStatus,
      compilationProgress: paper.compilationProgress,
      lastSyncError: paper.lastSyncError,
      isPublic: paper.isPublic,
      shareSlug: paper.shareSlug,
      repositoryId: repository?._id ?? null,
      trackedFileId: trackedFile?._id ?? null,
      lastSyncedAt: paper.lastSyncedAt,
      lastAffectedCommitTime: paper.lastAffectedCommitTime,
      lastAffectedCommitAuthor: paper.lastAffectedCommitAuthor,
      createdAt: paper._creationTime,
      updatedAt: paper.updatedAt,
    })));
  },
});

// List all papers for a user with pagination (gallery)
export const listPaginated = query({
  args: { userId: v.id("users"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.userId) {
      return { page: [], isDone: true, continueCursor: null };
    }

    const base = await fetchUserPapersBase(ctx, args.userId);
    const sortedPapers = sortPapersByTime(base.papers);

    const parsedCursor = args.paginationOpts.cursor
      ? Number.parseInt(args.paginationOpts.cursor, 10)
      : 0;
    const startIndex = Number.isNaN(parsedCursor) ? 0 : parsedCursor;
    const endIndex = Math.min(startIndex + args.paginationOpts.numItems, sortedPapers.length);
    const pagePapers = sortedPapers.slice(startIndex, endIndex);

    const thumbnailIds = pagePapers.filter((p) => p.thumbnailFileId).map((p) => p.thumbnailFileId!);
    const pdfIds = pagePapers.filter((p) => p.pdfFileId).map((p) => p.pdfFileId!);

    const [thumbnailUrls, pdfUrls] = await Promise.all([
      Promise.all(thumbnailIds.map((id) => ctx.storage.getUrl(id))),
      Promise.all(pdfIds.map((id) => ctx.storage.getUrl(id))),
    ]);

    const thumbnailUrlMap = new Map(thumbnailIds.map((id, i) => [id, thumbnailUrls[i]]));
    const pdfUrlMap = new Map(pdfIds.map((id, i) => [id, pdfUrls[i]]));

    const enrichedPapers = pagePapers.map((paper) => {
      const repository = paper.repositoryId ? base.repositoryMap.get(paper.repositoryId) ?? null : null;
      const trackedFile = paper.trackedFileId ? base.trackedFileMap.get(paper.trackedFileId) ?? null : null;
      const thumbnailUrl = paper.thumbnailFileId ? thumbnailUrlMap.get(paper.thumbnailFileId) ?? null : null;
      const pdfUrl = paper.pdfFileId ? pdfUrlMap.get(paper.pdfFileId) ?? null : null;
      const isUpToDate = determineIfUpToDate(paper, repository);

      return {
        _id: paper._id,
        _creationTime: paper._creationTime,
        title: paper.title,
        authors: paper.authors,
        thumbnailUrl,
        pdfUrl,
        isUpToDate,
        pdfSourceType: trackedFile?.pdfSourceType ?? null,
        buildStatus: paper.buildStatus,
        compilationProgress: paper.compilationProgress,
        lastSyncError: paper.lastSyncError,
        isPublic: paper.isPublic,
        lastAffectedCommitTime: paper.lastAffectedCommitTime,
        updatedAt: paper.updatedAt,
        repository: repository
          ? {
              _id: repository._id,
              name: repository.name,
              gitUrl: repository.gitUrl,
              provider: repository.provider,
              lastSyncedAt: repository.lastSyncedAt,
              lastCommitTime: repository.lastCommitTime,
              syncStatus: repository.syncStatus,
            }
          : null,
      };
    });

    return {
      page: enrichedPapers,
      isDone: endIndex >= sortedPapers.length,
      continueCursor: endIndex < sortedPapers.length ? String(endIndex) : null,
    };
  },
});

// List minimal paper metadata for bulk operations
export const listMetadata = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.userId) {
      return [];
    }

    const base = await fetchUserPapersBase(ctx, args.userId);
    return base.papers.map((paper) => {
      const repository = paper.repositoryId ? base.repositoryMap.get(paper.repositoryId) ?? null : null;
      const isUpToDate = determineIfUpToDate(paper, repository);

      return {
        _id: paper._id,
        title: paper.title,
        repository,
        isUpToDate,
        buildStatus: paper.buildStatus,
      };
    });
  },
});

// List papers for mobile app (internal, auth handled by HTTP layer)
export const listForMobile = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const userId = args.userId as Id<"users">;
    const { papers } = await fetchUserPapers(ctx, userId);

    // Transform to mobile-specific format (simpler, no repository details)
    const enrichedPapers = papers.map(({ paper, trackedFile, thumbnailUrl, pdfUrl, isUpToDate }) => ({
      _id: paper._id,
      title: paper.title,
      authors: paper.authors,
      thumbnailUrl,
      pdfUrl,
      isUpToDate,
      buildStatus: paper.buildStatus,
      compilationProgress: paper.compilationProgress,
      lastSyncError: paper.lastSyncError,
      pdfSourceType: trackedFile?.pdfSourceType ?? null,
      lastAffectedCommitTime: paper.lastAffectedCommitTime,
      lastAffectedCommitAuthor: paper.lastAffectedCommitAuthor,
      updatedAt: paper.updatedAt,
      isPublic: paper.isPublic,
      createdAt: paper._creationTime,
    }));

    return sortPapersByTime(enrichedPapers);
  },
});

// Get a single paper for mobile app (internal, auth handled by HTTP layer)
export const getForMobile = internalQuery({
  args: { paperId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const paperId = args.paperId as Id<"papers">;
    const userId = args.userId as Id<"users">;

    const result = await fetchPaperWithAuth(ctx, paperId, userId);
    if (!result || !result.hasAccess) return null;

    const { paper, repository } = result;
    const trackedFile = paper.trackedFileId
      ? await ctx.db.get(paper.trackedFileId)
      : null;
    const thumbnailUrl = paper.thumbnailFileId
      ? await ctx.storage.getUrl(paper.thumbnailFileId)
      : null;
    const pdfUrl = paper.pdfFileId
      ? await ctx.storage.getUrl(paper.pdfFileId)
      : null;

    const isUpToDate = determineIfUpToDate(paper, repository);

    const compiler =
      trackedFile?.pdfSourceType === "compile"
        ? trackedFile.compiler ?? "pdflatex"
        : undefined;

    return {
      _id: paper._id,
      title: paper.title,
      authors: paper.authors,
      thumbnailUrl,
      pdfUrl,
      isUpToDate,
      buildStatus: paper.buildStatus,
      compilationProgress: paper.compilationProgress,
      lastSyncError: paper.lastSyncError,
      lastAffectedCommitTime: paper.lastAffectedCommitTime,
      lastAffectedCommitAuthor: paper.lastAffectedCommitAuthor,
      isPublic: paper.isPublic,
      createdAt: paper._creationTime,
      updatedAt: paper.updatedAt,
      trackedFile: trackedFile
        ? { pdfSourceType: trackedFile.pdfSourceType, compiler }
        : null,
    };
  },
});

// Delete paper for mobile app (internal, auth handled by HTTP layer)
export const deletePaperForMobile = internalMutation({
  args: { paperId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const paperId = args.paperId as Id<"papers">;
    const userId = args.userId as Id<"users">;

    const result = await fetchPaperWithAuth(ctx, paperId, userId);
    if (!result) throw new Error("Paper not found");
    if (!result.hasAccess) throw new Error("Unauthorized");

    const { paper } = result;
    // Store tracked file ID before deletion
    const trackedFileId = paper.trackedFileId;

    // Use shared helper to delete paper and all associated data
    await deletePaperAndAssociatedData(ctx, paper);

    // Delete associated tracked file if it exists
    if (trackedFileId) {
      await ctx.db.delete(trackedFileId);
    }
  },
});

// Update paper metadata for mobile app (internal, auth handled by HTTP layer)
export const updatePaperForMobile = internalMutation({
  args: {
    paperId: v.string(),
    userId: v.string(),
    title: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const paperId = args.paperId as Id<"papers">;
    const userId = args.userId as Id<"users">;

    const result = await fetchPaperWithAuth(ctx, paperId, userId);
    if (!result) throw new Error("Paper not found");
    if (!result.hasAccess) throw new Error("Unauthorized");

    // Validate field lengths
    validatePaperFieldsOrThrow({ title: args.title, authors: args.authors });

    const updates: { title?: string; authors?: string[]; updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (args.title !== undefined) updates.title = args.title;
    if (args.authors !== undefined) updates.authors = args.authors;

    await ctx.db.patch(paperId, updates);
  },
});

// Toggle public/private for mobile app (internal, auth handled by HTTP layer)
export const togglePublicForMobile = internalMutation({
  args: { paperId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const paperId = args.paperId as Id<"papers">;
    const userId = args.userId as Id<"users">;

    const result = await fetchPaperWithAuth(ctx, paperId, userId);
    if (!result) throw new Error("Paper not found");
    if (!result.hasAccess) throw new Error("Unauthorized");

    const { paper } = result;
    const isPublic = !paper.isPublic;
    const shareSlug = isPublic && !paper.shareSlug ? generateSlug(paper.title) : paper.shareSlug;

    await ctx.db.patch(paperId, {
      isPublic,
      shareSlug,
      updatedAt: Date.now(),
    });

    return { isPublic, shareSlug };
  },
});

// Get public papers (for gallery) with pagination
export const listPublic = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const paginatedResult = await ctx.db
      .query("papers")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .order("desc")
      .paginate(args.paginationOpts);

    const papers = paginatedResult.page;

    // Batch fetch all storage URLs upfront to avoid N+1 queries
    const thumbnailIds = papers
      .filter((p) => p.thumbnailFileId)
      .map((p) => p.thumbnailFileId!);
    const pdfIds = papers
      .filter((p) => p.pdfFileId)
      .map((p) => p.pdfFileId!);

    const [thumbnailUrls, pdfUrls] = await Promise.all([
      Promise.all(thumbnailIds.map((id) => ctx.storage.getUrl(id))),
      Promise.all(pdfIds.map((id) => ctx.storage.getUrl(id))),
    ]);

    const thumbnailUrlMap = new Map(
      thumbnailIds.map((id, i) => [id, thumbnailUrls[i]])
    );
    const pdfUrlMap = new Map(pdfIds.map((id, i) => [id, pdfUrls[i]]));

    // Now enrich synchronously - no await needed inside the map
    const enrichedPapers = papers.map((paper) => ({
      _id: paper._id,
      _creationTime: paper._creationTime,
      title: paper.title,
      authors: paper.authors,
      thumbnailUrl: paper.thumbnailFileId
        ? thumbnailUrlMap.get(paper.thumbnailFileId) ?? null
        : null,
      pdfUrl: paper.pdfFileId
        ? pdfUrlMap.get(paper.pdfFileId) ?? null
        : null,
      isPublic: paper.isPublic,
      lastAffectedCommitTime: paper.lastAffectedCommitTime,
      updatedAt: paper.updatedAt,
    }));

    return {
      ...paginatedResult,
      page: enrichedPapers,
    };
  },
});

// Get a single paper by ID
export const get = query({
  args: { id: v.id("papers") },
  handler: async (ctx, args) => {
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      return null;
    }

    const result = await fetchPaperWithAuth(ctx, args.id, authenticatedUserId);
    if (!result || !result.hasAccess) return null;

    const { paper, repository } = result;
    const trackedFile = paper.trackedFileId
      ? await ctx.db.get(paper.trackedFileId)
      : null;
    const thumbnailUrl = paper.thumbnailFileId
      ? await ctx.storage.getUrl(paper.thumbnailFileId)
      : null;
    const pdfUrl = paper.pdfFileId
      ? await ctx.storage.getUrl(paper.pdfFileId)
      : null;

    const isUpToDate = determineIfUpToDate(paper, repository);

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
      _id: paper._id,
      _creationTime: paper._creationTime,
      title: paper.title,
      authors: paper.authors,
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
  },
  handler: async (ctx, args) => {
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) throw new Error("Unauthorized");

    const result = await fetchPaperWithAuth(ctx, args.id, authenticatedUserId);
    if (!result) throw new Error("Paper not found");
    if (!result.hasAccess) throw new Error("Unauthorized");

    // Validate field lengths to prevent storage abuse
    validatePaperFieldsOrThrow({ title: args.title, authors: args.authors });

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

// Toggle public/private and generate share slug
export const togglePublic = mutation({
  args: { id: v.id("papers") },
  handler: async (ctx, args) => {
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) throw new Error("Unauthorized");

    const result = await fetchPaperWithAuth(ctx, args.id, authenticatedUserId);
    if (!result) throw new Error("Paper not found");
    if (!result.hasAccess) throw new Error("Unauthorized");

    const { paper } = result;
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
export const updatePdfCache = internalMutation({
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
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Unauthorized");
    }
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
      v.literal("compile")
    ),
    compiler: v.optional(v.union(
      v.literal("pdflatex"),
      v.literal("xelatex"),
      v.literal("lualatex")
    )),
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

    // Validate title length
    validateTitleOrThrow(args.title);

    // Validate file path (prevents path traversal attacks)
    const filePathValidation = validateFilePath(args.filePath);
    if (!filePathValidation.valid) {
      throw new Error(filePathValidation.error);
    }

    const normalizedPath = filePathValidation.normalized;

    // Determine file type from extension
    const fileType = normalizedPath.endsWith(".pdf") ? "pdf" : "tex";

    const existingTrackedFile = await ctx.db
      .query("trackedFiles")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .filter((q) => q.eq(q.field("filePath"), normalizedPath))
      .first();

    if (existingTrackedFile) {
      const patchData: Record<string, unknown> = {
        isActive: true,
        pdfSourceType: args.pdfSourceType,
      };

      if (args.pdfSourceType === "compile") {
        patchData.compiler = args.compiler ?? "pdflatex";
      } else {
        patchData.compiler = undefined;
      }

      await ctx.db.patch(existingTrackedFile._id, patchData);

      const existingPaper = await ctx.db
        .query("papers")
        .withIndex("by_tracked_file", (q) => q.eq("trackedFileId", existingTrackedFile._id))
        .first();

      if (existingPaper) {
        return { trackedFileId: existingTrackedFile._id, paperId: existingPaper._id };
      }

      const paperId = await ctx.db.insert("papers", {
        repositoryId: args.repositoryId,
        userId: repository.userId,
        trackedFileId: existingTrackedFile._id,
        title: args.title,
        isPublic: false,
        updatedAt: Date.now(),
      });

      return { trackedFileId: existingTrackedFile._id, paperId };
    }

    // Create tracked file
    const trackedFileData: {
      repositoryId: Id<"repositories">;
      filePath: string;
      fileType: "tex" | "pdf";
      pdfSourceType: "committed" | "compile";
      isActive: boolean;
      compiler?: "pdflatex" | "xelatex" | "lualatex";
    } = {
      repositoryId: args.repositoryId,
      filePath: normalizedPath, // Use normalized path
      fileType: fileType as "tex" | "pdf",
      pdfSourceType: args.pdfSourceType,
      isActive: true,
    };
    if (args.pdfSourceType === "compile") {
      trackedFileData.compiler = args.compiler ?? "pdflatex";
    }

    const trackedFileId = await ctx.db.insert("trackedFiles", trackedFileData);

    // Create paper
    const paperId = await ctx.db.insert("papers", {
      repositoryId: args.repositoryId,
      userId: repository.userId,
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
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Get associated papers and filter out orphaned tracked files
    const filesWithPapers = await Promise.all(
      trackedFiles.map(async (file) => {
        const paper = await ctx.db
          .query("papers")
          .withIndex("by_tracked_file", (q) => q.eq("trackedFileId", file._id))
          .first();
        return paper ? { _id: file._id, filePath: file.filePath } : null;
      })
    );

    // Only return tracked files that have an associated paper
    return filesWithPapers.filter((f): f is NonNullable<typeof f> => f !== null);
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
    thumbnailStorageId: v.optional(v.id("_storage")),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Authorization check: verify the caller owns this userId
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId || authenticatedUserId !== args.userId) {
      throw new Error("Unauthorized");
    }

    // Validate title length
    validateTitleOrThrow(args.title);

    const paperId = await ctx.db.insert("papers", {
      userId: args.userId,
      title: args.title,
      pdfFileId: args.pdfStorageId,
      thumbnailFileId: args.thumbnailStorageId,
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
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) throw new Error("Unauthorized");

    const result = await fetchPaperWithAuth(ctx, args.id, authenticatedUserId);
    if (!result) throw new Error("Paper not found");
    if (!result.hasAccess) throw new Error("Unauthorized");

    const { paper } = result;
    // Store tracked file ID before deletion (cascade delete removes the paper)
    const trackedFileId = paper.trackedFileId;

    // Use shared helper to delete paper and all associated data
    await deletePaperAndAssociatedData(ctx, paper);

    // Delete associated tracked file if it exists
    if (trackedFileId) {
      await ctx.db.delete(trackedFileId);
    }
  },
});

// List version history for a paper
export const listVersions = query({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) return [];

    const result = await fetchPaperWithAuth(ctx, args.paperId, authenticatedUserId);
    if (!result || !result.hasAccess) return [];

    // Get all versions for this paper
    const versions = await ctx.db
      .query("paperVersions")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    // Batch fetch all storage URLs upfront to avoid N+1 queries
    const pdfIds = versions.map((v) => v.pdfFileId);
    const thumbnailIds = versions
      .filter((v) => v.thumbnailFileId)
      .map((v) => v.thumbnailFileId!);

    const [pdfUrls, thumbnailUrls] = await Promise.all([
      Promise.all(pdfIds.map((id) => ctx.storage.getUrl(id))),
      Promise.all(thumbnailIds.map((id) => ctx.storage.getUrl(id))),
    ]);

    const pdfUrlMap = new Map(pdfIds.map((id, i) => [id, pdfUrls[i]]));
    const thumbnailUrlMap = new Map(
      thumbnailIds.map((id, i) => [id, thumbnailUrls[i]])
    );

    // Enrich synchronously and sort by date (newest first)
    const enrichedVersions = versions.map((version) => ({
      ...version,
      pdfUrl: pdfUrlMap.get(version.pdfFileId) ?? null,
      thumbnailUrl: version.thumbnailFileId
        ? thumbnailUrlMap.get(version.thumbnailFileId) ?? null
        : null,
    }));

    return enrichedVersions.sort((a, b) => b.versionCreatedAt - a.versionCreatedAt);
  },
});

// Get a specific version
export const getVersion = query({
  args: {
    paperId: v.id("papers"),
    versionId: v.id("paperVersions"),
  },
  handler: async (ctx, args) => {
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) return null;

    const result = await fetchPaperWithAuth(ctx, args.paperId, authenticatedUserId);
    if (!result || !result.hasAccess) return null;

    const version = await ctx.db.get(args.versionId);
    if (!version || version.paperId !== args.paperId) {
      return null;
    }

    const pdfUrl = await ctx.storage.getUrl(version.pdfFileId);
    const thumbnailUrl = version.thumbnailFileId
      ? await ctx.storage.getUrl(version.thumbnailFileId)
      : null;

    return {
      ...version,
      pdfUrl,
      thumbnailUrl,
    };
  },
});

// Delete old versions (keep the most recent N versions)
export const deleteOldVersions = mutation({
  args: {
    paperId: v.id("papers"),
    keepCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const keepCount = args.keepCount ?? 10;

    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) throw new Error("Unauthorized");

    const result = await fetchPaperWithAuth(ctx, args.paperId, authenticatedUserId);
    if (!result) throw new Error("Paper not found");
    if (!result.hasAccess) throw new Error("Unauthorized");

    // Get all versions sorted by date (newest first)
    const versions = await ctx.db
      .query("paperVersions")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    const sortedVersions = versions.sort((a, b) => b.versionCreatedAt - a.versionCreatedAt);

    // Delete versions beyond the keep count
    const versionsToDelete = sortedVersions.slice(keepCount);

    // Collect all storage delete promises for parallel execution
    const storageDeletePromises: Promise<void>[] = [];
    for (const version of versionsToDelete) {
      if (version.pdfFileId) {
        storageDeletePromises.push(ctx.storage.delete(version.pdfFileId));
      }
      if (version.thumbnailFileId) {
        storageDeletePromises.push(ctx.storage.delete(version.thumbnailFileId));
      }
    }

    // Execute all storage deletions in parallel, then delete DB records
    await Promise.all(storageDeletePromises);
    for (const version of versionsToDelete) {
      await ctx.db.delete(version._id);
    }

    return { deletedCount: versionsToDelete.length };
  },
});

// Toggle pinned status of a version
export const toggleVersionPinned = mutation({
  args: {
    versionId: v.id("paperVersions"),
  },
  handler: async (ctx, args) => {
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) throw new Error("Unauthorized");

    const version = await ctx.db.get(args.versionId);
    if (!version) throw new Error("Version not found");

    const result = await fetchPaperWithAuth(ctx, version.paperId, authenticatedUserId);
    if (!result) throw new Error("Paper not found");
    if (!result.hasAccess) throw new Error("Unauthorized");

    // Toggle pinned status
    const newPinned = !version.pinned;
    await ctx.db.patch(args.versionId, { pinned: newPinned });

    return { pinned: newPinned };
  },
});

// Max age for non-pinned versions (90 days in milliseconds)
const VERSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Internal mutation to clean up old versions (called after version creation)
// Keeps all pinned versions + last N non-pinned versions that are less than 90 days old
export const cleanupOldVersions = internalMutation({
  args: {
    paperId: v.id("papers"),
    keepCount: v.optional(v.number()),
    maxAgeMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const keepCount = args.keepCount ?? 5;
    const maxAgeMs = args.maxAgeMs ?? VERSION_MAX_AGE_MS;
    const now = Date.now();

    // Get all versions for this paper
    const versions = await ctx.db
      .query("paperVersions")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    // Separate pinned and non-pinned versions
    const pinnedVersions = versions.filter((v) => v.pinned);
    const nonPinnedVersions = versions.filter((v) => !v.pinned);

    // Sort non-pinned by date (newest first)
    const sortedNonPinned = nonPinnedVersions.sort(
      (a, b) => b.versionCreatedAt - a.versionCreatedAt
    );

    // Delete versions that are either:
    // 1. Beyond the keepCount threshold, OR
    // 2. Older than maxAgeMs (even if within keepCount)
    const versionsToDelete = sortedNonPinned.filter((version, index) => {
      const isOverCount = index >= keepCount;
      const isOverAge = now - version.versionCreatedAt > maxAgeMs;
      return isOverCount || isOverAge;
    });

    if (versionsToDelete.length === 0) {
      return { deletedCount: 0, keptPinned: pinnedVersions.length };
    }

    // Collect all storage delete promises for parallel execution
    const storageDeletePromises: Promise<void>[] = [];
    for (const version of versionsToDelete) {
      if (version.pdfFileId) {
        storageDeletePromises.push(ctx.storage.delete(version.pdfFileId));
      }
      if (version.thumbnailFileId) {
        storageDeletePromises.push(ctx.storage.delete(version.thumbnailFileId));
      }
    }

    // Execute all storage deletions in parallel, then delete DB records
    await Promise.all(storageDeletePromises);
    for (const version of versionsToDelete) {
      await ctx.db.delete(version._id);
    }

    return { deletedCount: versionsToDelete.length, keptPinned: pinnedVersions.length };
  },
});

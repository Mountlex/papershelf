import { v } from "convex/values";
import { action, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";

// Check if repository is currently syncing (used for optimistic locking)
export const getRepositorySyncStatus = internalQuery({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.id);
    return repo?.syncStatus || "idle";
  },
});

// Sync lock timeout in milliseconds (5 minutes)
const SYNC_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// Try to acquire sync lock - returns true if lock acquired, false if already syncing
export const tryAcquireSyncLock = internalMutation({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.id);
    if (!repo) return false;

    const now = Date.now();

    // If already syncing, check if the lock has timed out
    if (repo.syncStatus === "syncing") {
      // If lastSyncedAt exists and the sync has been running for too long, consider it stale
      // We use lastSyncedAt as a proxy - if it's been more than SYNC_LOCK_TIMEOUT_MS since
      // the last successful sync and status is still "syncing", the lock is stale
      const lockStartTime = repo.lastSyncedAt || 0;
      const timeSinceLastSync = now - lockStartTime;

      if (timeSinceLastSync < SYNC_LOCK_TIMEOUT_MS) {
        // Lock is still valid, don't allow new sync
        return false;
      }
      // Lock has timed out, allow override
      console.log(`Sync lock for repository ${args.id} timed out after ${timeSinceLastSync}ms, allowing new sync`);
    }

    // Acquire the lock by setting status to syncing and updating lastSyncedAt as lock timestamp
    await ctx.db.patch(args.id, {
      syncStatus: "syncing",
      lastSyncedAt: now, // Use this as the lock acquisition time
    });
    return true;
  },
});

// Release sync lock (set status to idle or error)
export const releaseSyncLock = internalMutation({
  args: {
    id: v.id("repositories"),
    status: v.union(v.literal("idle"), v.literal("error")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { syncStatus: args.status });
  },
});

// Public mutation to reset a stuck sync status (for manual intervention)
export const resetSyncStatus = mutation({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    // Verify the user owns this repository
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Not authenticated");
    }

    const repo = await ctx.db.get(args.repositoryId);
    if (!repo || repo.userId !== authenticatedUserId) {
      throw new Error("Repository not found or access denied");
    }

    // Reset the sync status to idle
    await ctx.db.patch(args.repositoryId, { syncStatus: "idle" });
    return { success: true };
  },
});

// Internal mutation to update repository after sync
export const updateRepositoryAfterSync = internalMutation({
  args: {
    id: v.id("repositories"),
    lastCommitHash: v.string(),
    lastCommitTime: v.optional(v.number()),
    lastSyncedAt: v.number(),
    syncStatus: v.union(v.literal("idle"), v.literal("syncing"), v.literal("error")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      lastCommitHash: args.lastCommitHash,
      lastCommitTime: args.lastCommitTime,
      lastSyncedAt: args.lastSyncedAt,
      syncStatus: args.syncStatus,
    });
  },
});

// Sync a repository - fetch latest commit and update PDFs if needed
export const syncRepository = action({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    // Try to acquire sync lock (optimistic locking to prevent concurrent syncs)
    const lockAcquired = await ctx.runMutation(internal.sync.tryAcquireSyncLock, {
      id: args.repositoryId,
    });

    if (!lockAcquired) {
      throw new Error("Repository is already syncing. Please wait for the current sync to complete.");
    }

    try {
      // Get repository from DB
      const repository = await ctx.runQuery(internal.git.getRepository, {
        id: args.repositoryId,
      });

      if (!repository) {
        throw new Error("Repository not found");
      }

      // Fetch latest commit
      const latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
        gitUrl: repository.gitUrl,
        branch: repository.defaultBranch,
      });

      // Convert commit date to Unix timestamp
      const commitTime = new Date(latestCommit.date).getTime();

      // Check if we need to update
      if (repository.lastCommitHash === latestCommit.sha) {
        // No changes, just update sync time
        await ctx.runMutation(internal.sync.updateRepositoryAfterSync, {
          id: args.repositoryId,
          lastCommitHash: latestCommit.sha,
          lastCommitTime: commitTime,
          lastSyncedAt: Date.now(),
          syncStatus: "idle",
        });
        return { updated: false, commitHash: latestCommit.sha };
      }

      // Update repository with new commit
      await ctx.runMutation(internal.sync.updateRepositoryAfterSync, {
        id: args.repositoryId,
        lastCommitHash: latestCommit.sha,
        lastCommitTime: commitTime,
        lastSyncedAt: Date.now(),
        syncStatus: "idle",
      });

      return { updated: true, commitHash: latestCommit.sha };
    } catch (error) {
      // Release lock with error status on failure
      await ctx.runMutation(internal.sync.releaseSyncLock, {
        id: args.repositoryId,
        status: "error",
      });
      throw error;
    }
  },
});

// Update paper with PDF info
export const updatePaperPdf = internalMutation({
  args: {
    id: v.id("papers"),
    pdfFileId: v.id("_storage"),
    cachedCommitHash: v.string(),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      pdfFileId: args.pdfFileId,
      cachedCommitHash: args.cachedCommitHash,
      fileSize: args.fileSize,
      lastSyncError: undefined, // Clear any previous error on success
      updatedAt: Date.now(),
    });
  },
});

// Update paper sync error
export const updatePaperSyncError = internalMutation({
  args: {
    id: v.id("papers"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      lastSyncError: args.error,
      updatedAt: Date.now(),
    });
  },
});

// Sync a single paper - compile/fetch its PDF
export const syncPaper = action({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    // Get paper and related data
    const paper = await ctx.runQuery(internal.git.getPaper, { id: args.paperId });
    if (!paper) throw new Error("Paper not found");

    const trackedFile = await ctx.runQuery(internal.git.getTrackedFile, { id: paper.trackedFileId });
    if (!trackedFile) throw new Error("Tracked file not found");

    const repository = await ctx.runQuery(internal.git.getRepository, { id: paper.repositoryId });
    if (!repository) throw new Error("Repository not found");

    // Try to acquire sync lock (optimistic locking to prevent concurrent syncs)
    const lockAcquired = await ctx.runMutation(internal.sync.tryAcquireSyncLock, {
      id: repository._id,
    });

    if (!lockAcquired) {
      throw new Error("Repository is already syncing. Please wait for the current sync to complete.");
    }

    // Clear any previous sync error at the start
    await ctx.runMutation(internal.sync.updatePaperSyncError, {
      id: args.paperId,
      error: undefined,
    });

    try {
      // Fetch latest commit to check if we need to update
      const latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
        gitUrl: repository.gitUrl,
        branch: repository.defaultBranch,
      });

      // Convert commit date to Unix timestamp
      const commitTime = new Date(latestCommit.date).getTime();

      // Always update repository metadata with latest commit info
      await ctx.runMutation(internal.sync.updateRepositoryAfterSync, {
        id: repository._id,
        lastCommitHash: latestCommit.sha,
        lastCommitTime: commitTime,
        lastSyncedAt: Date.now(),
        syncStatus: "idle",
      });

      // Check if PDF is already cached for this commit
      if (paper.cachedCommitHash === latestCommit.sha && paper.pdfFileId) {
        return { updated: false, commitHash: latestCommit.sha };
      }

      let storageId: string;
      let fileSize: number;

      if (trackedFile.pdfSourceType === "compile") {
        // Compile LaTeX - returns storage ID directly
        const result = await ctx.runAction(internal.latex.compileLatexInternal, {
          gitUrl: repository.gitUrl,
          filePath: trackedFile.filePath,
          branch: repository.defaultBranch,
          paperId: args.paperId,
        });
        storageId = result.storageId;
        fileSize = result.size;
      } else {
        // Fetch committed PDF
        const pdfData = await ctx.runAction(internal.git.fetchFileContentInternal, {
          gitUrl: repository.gitUrl,
          filePath: trackedFile.filePath,
          branch: repository.defaultBranch,
        });
        // Store PDF in Convex storage
        const blob = new Blob([new Uint8Array(pdfData.content)], { type: "application/pdf" });
        storageId = await ctx.storage.store(blob);
        fileSize = pdfData.size;
      }

      // Update paper with new PDF (also clears lastSyncError)
      await ctx.runMutation(internal.sync.updatePaperPdf, {
        id: args.paperId,
        pdfFileId: storageId as Id<"_storage">,
        cachedCommitHash: latestCommit.sha,
        fileSize,
      });

      // Generate thumbnail (non-blocking, errors are logged but don't fail sync)
      try {
        await ctx.runAction(internal.thumbnail.generateThumbnail, {
          pdfFileId: storageId as Id<"_storage">,
          paperId: args.paperId,
        });
      } catch (error) {
        console.error("Thumbnail generation failed:", error);
      }

      return { updated: true, commitHash: latestCommit.sha };
    } catch (error) {
      // Store the error on the paper for UI display
      const errorMessage = error instanceof Error ? error.message : "Sync failed";
      await ctx.runMutation(internal.sync.updatePaperSyncError, {
        id: args.paperId,
        error: errorMessage,
      });

      // Release lock with error status on failure
      await ctx.runMutation(internal.sync.releaseSyncLock, {
        id: repository._id,
        status: "error",
      });
      throw error;
    }
  },
});

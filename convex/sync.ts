import { v } from "convex/values";
import { action, mutation, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { sleep, type DependencyHash } from "./lib/http";

// Helper function to check if any dependency files have changed
// Uses batch fetch to optimize Overleaf (single clone instead of one per file)
// Includes retry logic to avoid unnecessary recompilation due to transient errors
async function checkDependenciesChanged(
  ctx: ActionCtx,
  gitUrl: string,
  branch: string,
  cachedDeps: DependencyHash[]
): Promise<boolean> {
  if (cachedDeps.length === 0) {
    return false;
  }

  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Fetch all file hashes in one batch call
      const filePaths = cachedDeps.map((d) => d.path);
      const currentHashes = await ctx.runAction(internal.git.fetchFileHashBatchInternal, {
        gitUrl,
        filePaths,
        branch,
      });

      // Compare each dependency hash
      for (const dep of cachedDeps) {
        const currentHash = currentHashes[dep.path];
        if (currentHash === null || currentHash === undefined) {
          console.log(`Dependency missing or error: ${dep.path}`);
          return true; // File missing - assume changed
        }
        if (currentHash !== dep.hash) {
          console.log(`Dependency changed: ${dep.path} (${dep.hash} -> ${currentHash})`);
          return true; // File changed
        }
      }
      return false; // All dependencies unchanged
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s
        console.log(`Dependency check failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${backoffMs}ms: ${lastError.message}`);
        await sleep(backoffMs);
      }
    }
  }

  // All retries failed - assume dependencies changed to trigger recompilation
  console.log(`Could not check dependencies after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`);
  return true;
}

// Check if repository is currently syncing (used for optimistic locking)
export const getRepositorySyncStatus = internalQuery({
  args: { id: v.id("repositories") },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.id);
    return repo?.syncStatus || "idle";
  },
});

// Get papers for a repository (internal, for sync operations)
export const getPapersForRepository = internalQuery({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("papers")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();
    return papers;
  },
});

// Get tracked file by ID (internal)
export const getTrackedFileById = internalQuery({
  args: { id: v.id("trackedFiles") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Sync lock timeout in milliseconds (2 minutes - reduced from 5 to prevent long stuck syncs)
const SYNC_LOCK_TIMEOUT_MS = 2 * 60 * 1000;

// Generate a unique attempt ID
function generateAttemptId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

// Try to acquire sync lock - returns attempt ID if acquired, null if already syncing
export const tryAcquireSyncLock = internalMutation({
  args: { id: v.id("repositories") },
  handler: async (ctx, args): Promise<{ acquired: boolean; attemptId: string | null }> => {
    const repo = await ctx.db.get(args.id);
    if (!repo) return { acquired: false, attemptId: null };

    const now = Date.now();

    // If already syncing, check if the lock has timed out
    if (repo.syncStatus === "syncing") {
      // Use dedicated syncLockAcquiredAt field for timeout calculation
      const lockStartTime = repo.syncLockAcquiredAt || 0;
      const timeSinceLockAcquired = now - lockStartTime;

      if (timeSinceLockAcquired < SYNC_LOCK_TIMEOUT_MS) {
        // Lock is still valid, don't allow new sync
        return { acquired: false, attemptId: null };
      }
      // Lock has timed out, allow override
      console.log(`Sync lock for repository ${args.id} timed out after ${timeSinceLockAcquired}ms, allowing new sync`);
    }

    // Generate a new attempt ID
    const attemptId = generateAttemptId();

    // Acquire the lock by setting status to syncing and recording lock acquisition time
    await ctx.db.patch(args.id, {
      syncStatus: "syncing",
      syncLockAcquiredAt: now,
      currentSyncAttemptId: attemptId,
    });
    return { acquired: true, attemptId };
  },
});

// Validate that the given attempt ID matches the current sync attempt
export const validateSyncAttempt = internalQuery({
  args: {
    repositoryId: v.id("repositories"),
    attemptId: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const repo = await ctx.db.get(args.repositoryId);
    if (!repo) return false;
    return repo.currentSyncAttemptId === args.attemptId;
  },
});

// Release sync lock (set status to idle or error)
export const releaseSyncLock = internalMutation({
  args: {
    id: v.id("repositories"),
    status: v.union(v.literal("idle"), v.literal("error")),
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // If attemptId is provided, validate it first
    if (args.attemptId) {
      const repo = await ctx.db.get(args.id);
      if (repo && repo.currentSyncAttemptId !== args.attemptId) {
        console.log(`Sync attempt ${args.attemptId} superseded, skipping lock release`);
        return;
      }
    }
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
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; reason?: string }> => {
    // If attemptId is provided, validate it first
    if (args.attemptId) {
      const repo = await ctx.db.get(args.id);
      if (repo && repo.currentSyncAttemptId !== args.attemptId) {
        console.log(`Sync attempt ${args.attemptId} superseded, skipping repository update`);
        return { success: false, reason: "superseded" };
      }
    }

    await ctx.db.patch(args.id, {
      lastCommitHash: args.lastCommitHash,
      lastCommitTime: args.lastCommitTime,
      lastSyncedAt: args.lastSyncedAt,
      syncStatus: args.syncStatus,
    });
    return { success: true };
  },
});

// Sync a repository - fetch latest commit and update PDFs if needed
export const syncRepository = action({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const repository = await ctx.runQuery(internal.git.getRepository, {
      id: args.repositoryId,
    });
    if (!repository || repository.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // Try to acquire sync lock (optimistic locking to prevent concurrent syncs)
    const lockResult = await ctx.runMutation(internal.sync.tryAcquireSyncLock, {
      id: args.repositoryId,
    });

    if (!lockResult.acquired || !lockResult.attemptId) {
      throw new Error("Repository is already syncing. Please wait for the current sync to complete.");
    }

    const attemptId = lockResult.attemptId;

    try {
      // Repository already loaded and authorized above

      // Fetch latest commit
      const latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
        gitUrl: repository.gitUrl,
        branch: repository.defaultBranch,
      });

      // Convert commit date to Unix timestamp
      const commitTime = new Date(latestCommit.date).getTime();

      // Get all papers for this repository
      const papers = await ctx.runQuery(internal.sync.getPapersForRepository, {
        repositoryId: args.repositoryId,
      });

      // Check if we need to update
      if (repository.lastCommitHash === latestCommit.sha) {
        // No changes, just update sync time
        const result = await ctx.runMutation(internal.sync.updateRepositoryAfterSync, {
          id: args.repositoryId,
          lastCommitHash: latestCommit.sha,
          lastCommitTime: commitTime,
          lastSyncedAt: Date.now(),
          syncStatus: "idle",
          attemptId,
        });
        if (!result.success) {
          console.log(`Sync attempt ${attemptId} was superseded`);
        }
        return { updated: false, commitHash: latestCommit.sha };
      }

      // Validate attempt before expensive operations
      const isStillValid = await ctx.runQuery(internal.sync.validateSyncAttempt, {
        repositoryId: args.repositoryId,
        attemptId,
      });
      if (!isStillValid) {
        console.log(`Sync attempt ${attemptId} was superseded before processing papers`);
        return { updated: false, commitHash: latestCommit.sha, superseded: true };
      }

      // New commit detected - compute needsSync for each paper
      for (const paper of papers) {
        // Skip papers without tracked files
        if (!paper.trackedFileId) continue;

        const trackedFile = await ctx.runQuery(internal.sync.getTrackedFileById, {
          id: paper.trackedFileId,
        });

        // If paper has never been synced, it needs sync
        if (!paper.pdfFileId || !paper.cachedCommitHash) {
          await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
            id: paper._id,
            needsSync: true,
            repositoryId: args.repositoryId,
            attemptId,
          });
          continue;
        }

        // For committed PDF source type, check if the PDF file's blob hash changed
        if (trackedFile && trackedFile.pdfSourceType === "committed" && paper.cachedPdfBlobHash) {
          try {
            // Check if the PDF file itself has changed by comparing blob hashes
            const currentHashes = await ctx.runAction(internal.git.fetchFileHashBatchInternal, {
              gitUrl: repository.gitUrl,
              filePaths: [trackedFile.filePath],
              branch: repository.defaultBranch,
            });
            const currentPdfHash = currentHashes[trackedFile.filePath];

            if (currentPdfHash && currentPdfHash === paper.cachedPdfBlobHash) {
              // PDF file unchanged - just update commit hash, skip re-download
              console.log(`Committed PDF unchanged for paper ${paper._id}, skipping re-download`);
              await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
                id: paper._id,
                cachedCommitHash: latestCommit.sha,
                repositoryId: args.repositoryId,
                attemptId,
              });
              continue;
            }
          } catch (error) {
            // If hash check fails, fall through to needsSync=true
            console.log(`Could not check PDF hash for paper ${paper._id}: ${error}`);
          }
        }

        // For non-compile source types (without cached hash), always need sync when commit changes
        if (!trackedFile || trackedFile.pdfSourceType !== "compile") {
          await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
            id: paper._id,
            needsSync: true,
            repositoryId: args.repositoryId,
            attemptId,
          });
          continue;
        }

        // For compile source type with cached dependencies, check if any changed
        if (paper.cachedDependencies && paper.cachedDependencies.length > 0) {
          const dependenciesChanged = await checkDependenciesChanged(
            ctx,
            repository.gitUrl,
            repository.defaultBranch,
            paper.cachedDependencies
          );

          if (!dependenciesChanged) {
            // Dependencies unchanged - update commit hash without recompilation
            await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
              id: paper._id,
              cachedCommitHash: latestCommit.sha,
              repositoryId: args.repositoryId,
              attemptId,
            });
            continue;
          }
        }

        // Dependencies changed or no cached dependencies - needs sync
        await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
          id: paper._id,
          needsSync: true,
          repositoryId: args.repositoryId,
          attemptId,
        });
      }

      // Update repository with new commit
      const result = await ctx.runMutation(internal.sync.updateRepositoryAfterSync, {
        id: args.repositoryId,
        lastCommitHash: latestCommit.sha,
        lastCommitTime: commitTime,
        lastSyncedAt: Date.now(),
        syncStatus: "idle",
        attemptId,
      });

      if (!result.success) {
        console.log(`Sync attempt ${attemptId} was superseded at final update`);
        return { updated: true, commitHash: latestCommit.sha, superseded: true };
      }

      return { updated: true, commitHash: latestCommit.sha };
    } catch (error) {
      // Release lock on failure (paper errors are tracked per paper, not on repository)
      await ctx.runMutation(internal.sync.releaseSyncLock, {
        id: args.repositoryId,
        status: "idle",
        attemptId,
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
    cachedDependencies: v.optional(v.array(v.object({
      path: v.string(),
      hash: v.string(),
    }))),
    // For committed PDFs: store the blob hash to detect changes
    cachedPdfBlobHash: v.optional(v.string()),
    repositoryId: v.optional(v.id("repositories")),
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; reason?: string }> => {
    // If attemptId and repositoryId are provided, validate first
    if (args.attemptId && args.repositoryId) {
      const repo = await ctx.db.get(args.repositoryId);
      if (repo && repo.currentSyncAttemptId !== args.attemptId) {
        console.log(`Sync attempt ${args.attemptId} superseded, skipping paper PDF update`);
        return { success: false, reason: "superseded" };
      }
    }

    // Get current paper to create version history entry
    const paper = await ctx.db.get(args.id);
    if (paper?.pdfFileId && paper?.cachedCommitHash) {
      // Create a version entry for the current (soon to be previous) PDF
      await ctx.db.insert("paperVersions", {
        paperId: args.id,
        commitHash: paper.cachedCommitHash,
        versionCreatedAt: paper.updatedAt || Date.now(),
        pdfFileId: paper.pdfFileId,
        thumbnailFileId: paper.thumbnailFileId,
        fileSize: paper.fileSize,
        pageCount: paper.pageCount,
      });
    }

    await ctx.db.patch(args.id, {
      pdfFileId: args.pdfFileId,
      cachedCommitHash: args.cachedCommitHash,
      fileSize: args.fileSize,
      cachedDependencies: args.cachedDependencies,
      cachedPdfBlobHash: args.cachedPdfBlobHash, // Store PDF blob hash for committed PDFs
      needsSync: false, // Just synced successfully
      needsSyncSetAt: undefined, // Clear the timestamp when sync completes
      lastSyncError: undefined, // Clear any previous error on success
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// Update paper sync error
export const updatePaperSyncError = internalMutation({
  args: {
    id: v.id("papers"),
    error: v.optional(v.string()),
    repositoryId: v.optional(v.id("repositories")),
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // If attemptId and repositoryId are provided, validate first to prevent stale updates
    if (args.attemptId && args.repositoryId) {
      const repo = await ctx.db.get(args.repositoryId);
      if (repo && repo.currentSyncAttemptId !== args.attemptId) {
        console.log(`Skipping stale error update for paper ${args.id} (attempt ${args.attemptId} superseded)`);
        return;
      }
    }
    await ctx.db.patch(args.id, {
      lastSyncError: args.error,
      updatedAt: Date.now(),
    });
  },
});

// Update paper commit hash only (when dependencies haven't changed)
export const updatePaperCommitOnly = internalMutation({
  args: {
    id: v.id("papers"),
    cachedCommitHash: v.string(),
    repositoryId: v.optional(v.id("repositories")),
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // If attemptId and repositoryId are provided, validate first to prevent stale updates
    if (args.attemptId && args.repositoryId) {
      const repo = await ctx.db.get(args.repositoryId);
      if (repo && repo.currentSyncAttemptId !== args.attemptId) {
        console.log(`Skipping stale commit update for paper ${args.id} (attempt ${args.attemptId} superseded)`);
        return;
      }
    }
    await ctx.db.patch(args.id, {
      cachedCommitHash: args.cachedCommitHash,
      needsSync: false,
      needsSyncSetAt: undefined, // Clear the timestamp when sync completes
      lastSyncError: undefined,
      updatedAt: Date.now(),
    });
  },
});

// Update paper's needsSync flag (used during quick sync)
export const updatePaperNeedsSync = internalMutation({
  args: {
    id: v.id("papers"),
    needsSync: v.boolean(),
    repositoryId: v.optional(v.id("repositories")),
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // If attemptId and repositoryId are provided, validate first to prevent stale updates
    if (args.attemptId && args.repositoryId) {
      const repo = await ctx.db.get(args.repositoryId);
      if (repo && repo.currentSyncAttemptId !== args.attemptId) {
        console.log(`Skipping stale needsSync update for paper ${args.id} (attempt ${args.attemptId} superseded)`);
        return;
      }
    }
    await ctx.db.patch(args.id, {
      needsSync: args.needsSync,
      // Track when needsSync was set to true (for detecting stale flags)
      needsSyncSetAt: args.needsSync ? Date.now() : undefined,
    });
  },
});

// Sync a single paper - compile/fetch its PDF
export const syncPaper = action({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Get paper and related data
    const paper = await ctx.runQuery(internal.git.getPaper, { id: args.paperId });
    if (!paper) throw new Error("Paper not found");

    if (!paper.trackedFileId || !paper.repositoryId) {
      throw new Error("Paper is not linked to a repository");
    }

    const trackedFile = await ctx.runQuery(internal.git.getTrackedFile, { id: paper.trackedFileId });
    if (!trackedFile) throw new Error("Tracked file not found");

    const repository = await ctx.runQuery(internal.git.getRepository, { id: paper.repositoryId });
    if (!repository) throw new Error("Repository not found");
    if (repository.userId !== userId) {
      throw new Error("Unauthorized");
    }
    if (trackedFile.repositoryId !== repository._id || paper.repositoryId !== repository._id) {
      throw new Error("Invalid paper configuration");
    }

    // Try to acquire sync lock (optimistic locking to prevent concurrent syncs)
    const lockResult = await ctx.runMutation(internal.sync.tryAcquireSyncLock, {
      id: repository._id,
    });

    if (!lockResult.acquired || !lockResult.attemptId) {
      throw new Error("Repository is already syncing. Please wait for the current sync to complete.");
    }

    const attemptId = lockResult.attemptId;

    // Clear any previous sync error at the start
    await ctx.runMutation(internal.sync.updatePaperSyncError, {
      id: args.paperId,
      error: undefined,
      repositoryId: repository._id,
      attemptId,
    });

    try {
      // Fetch latest commit to check if we need to update
      const latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
        gitUrl: repository.gitUrl,
        branch: repository.defaultBranch,
      });

      // Convert commit date to Unix timestamp
      const commitTime = new Date(latestCommit.date).getTime();

      // Validate attempt before expensive operations
      const isStillValid = await ctx.runQuery(internal.sync.validateSyncAttempt, {
        repositoryId: repository._id,
        attemptId,
      });
      if (!isStillValid) {
        console.log(`Sync attempt ${attemptId} was superseded before paper sync`);
        return { updated: false, commitHash: latestCommit.sha, superseded: true };
      }

      // Always update repository metadata with latest commit info
      await ctx.runMutation(internal.sync.updateRepositoryAfterSync, {
        id: repository._id,
        lastCommitHash: latestCommit.sha,
        lastCommitTime: commitTime,
        lastSyncedAt: Date.now(),
        syncStatus: "idle",
        attemptId,
      });

      // Check if PDF is already cached for this commit
      if (paper.cachedCommitHash === latestCommit.sha && paper.pdfFileId) {
        return { updated: false, commitHash: latestCommit.sha };
      }

      // Check if any dependency files actually changed (for compile source type)
      if (
        trackedFile.pdfSourceType === "compile" &&
        paper.cachedDependencies &&
        paper.cachedDependencies.length > 0 &&
        paper.pdfFileId
      ) {
        const dependenciesChanged = await checkDependenciesChanged(
          ctx,
          repository.gitUrl,
          repository.defaultBranch,
          paper.cachedDependencies
        );

        if (!dependenciesChanged) {
          console.log(`Dependencies unchanged for paper ${args.paperId}, skipping recompilation`);
          // Just update the commit hash, no recompilation needed
          await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
            id: args.paperId,
            cachedCommitHash: latestCommit.sha,
            repositoryId: repository._id,
            attemptId,
          });
          return { updated: false, commitHash: latestCommit.sha, reason: "dependencies_unchanged" };
        }
      }

      // Validate attempt before expensive compile/fetch operations
      const isStillValidBeforeCompile = await ctx.runQuery(internal.sync.validateSyncAttempt, {
        repositoryId: repository._id,
        attemptId,
      });
      if (!isStillValidBeforeCompile) {
        console.log(`Sync attempt ${attemptId} was superseded before compile/fetch`);
        return { updated: false, commitHash: latestCommit.sha, superseded: true };
      }

      let storageId: string;
      let fileSize: number;
      let dependencies: Array<{ path: string; hash: string }> | undefined;
      let pdfBlobHash: string | undefined;

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
        dependencies = result.dependencies;
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

        // For committed PDFs, fetch and store the blob hash for future change detection
        try {
          const hashes = await ctx.runAction(internal.git.fetchFileHashBatchInternal, {
            gitUrl: repository.gitUrl,
            filePaths: [trackedFile.filePath],
            branch: repository.defaultBranch,
          });
          pdfBlobHash = hashes[trackedFile.filePath] ?? undefined;
        } catch (error) {
          console.log(`Could not fetch PDF blob hash: ${error}`);
        }
      }

      // Update paper with new PDF (also clears lastSyncError)
      const updateResult = await ctx.runMutation(internal.sync.updatePaperPdf, {
        id: args.paperId,
        pdfFileId: storageId as Id<"_storage">,
        cachedCommitHash: latestCommit.sha,
        fileSize,
        cachedDependencies: dependencies,
        cachedPdfBlobHash: pdfBlobHash,
        repositoryId: repository._id,
        attemptId,
      });

      if (!updateResult.success) {
        console.log(`Sync attempt ${attemptId} was superseded at paper PDF update`);
        return { updated: true, commitHash: latestCommit.sha, superseded: true };
      }

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
        repositoryId: repository._id,
        attemptId,
      });

      // Release lock on failure (paper errors are tracked per paper, not on repository)
      await ctx.runMutation(internal.sync.releaseSyncLock, {
        id: repository._id,
        status: "idle",
        attemptId,
      });
      throw error;
    }
  },
});

import { v } from "convex/values";
import { action, mutation, internalMutation, internalQuery, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { sleep, type DependencyHash } from "./lib/http";
import { isFileNotFoundError } from "./lib/providers/types";
import { getUserRateLimitConfig, type UserRateLimitAction } from "./lib/rateLimit";

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

/**
 * Calculate commit time from a commit response.
 *
 * When the commit is unchanged (Overleaf optimization), use the repository's
 * cached lastCommitTime to ensure consistency between repo and paper timestamps.
 * Returns undefined if no reliable commit time is available.
 */
function getCommitTime(
  latestCommit: { unchanged?: boolean; date?: string; dateIsFallback?: boolean },
  repositoryLastCommitTime: number | undefined
): number | undefined {
  if (latestCommit.unchanged) {
    return repositoryLastCommitTime;
  }
  if (!latestCommit.date || latestCommit.dateIsFallback) {
    return undefined;
  }
  const parsed = Date.parse(latestCommit.date);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Get the commit author name.
 *
 * When the commit is unchanged (Overleaf optimization) or author is not available
 * (e.g., Overleaf git fetch failed), use the repository's cached lastCommitAuthor.
 */
function getCommitAuthor(
  latestCommit: { unchanged?: boolean; authorName?: string },
  repositoryLastCommitAuthor: string | undefined
): string | undefined {
  if (latestCommit.unchanged || !latestCommit.authorName) {
    return repositoryLastCommitAuthor;
  }
  return latestCommit.authorName;
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

// Get multiple tracked files by IDs (batch query for sync optimization)
export const getTrackedFilesByIds = internalQuery({
  args: { ids: v.array(v.id("trackedFiles")) },
  handler: async (ctx, args) => {
    const files = await Promise.all(args.ids.map(id => ctx.db.get(id)));
    return files.filter((f): f is NonNullable<typeof f> => f !== null);
  },
});

// Sync lock timeout in milliseconds (2 minutes - reduced from 5 to prevent long stuck syncs)
const SYNC_LOCK_TIMEOUT_MS = 2 * 60 * 1000;

// Build lock timeout in milliseconds (5 minutes - longer for compilation)
const BUILD_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

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

export const getUserRateLimitLock = internalQuery({
  args: {
    userId: v.id("users"),
    action: v.union(
      v.literal("refresh_repository"),
      v.literal("build_paper"),
      v.literal("refresh_all_repositories")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userRateLimitLocks")
      .withIndex("by_user_action", (q) =>
        q.eq("userId", args.userId).eq("action", args.action)
      )
      .first();
  },
});

export const countUserRateLimitAttempts = internalQuery({
  args: {
    userId: v.id("users"),
    action: v.union(
      v.literal("refresh_repository"),
      v.literal("build_paper"),
      v.literal("refresh_all_repositories")
    ),
    windowStart: v.number(),
  },
  handler: async (ctx, args) => {
    const attempts = await ctx.db
      .query("userRateLimitAttempts")
      .withIndex("by_user_action_time", (q) =>
        q.eq("userId", args.userId).eq("action", args.action).gte("attemptedAt", args.windowStart)
      )
      .collect();
    return attempts.length;
  },
});

export const insertUserRateLimitAttempt = internalMutation({
  args: {
    userId: v.id("users"),
    action: v.union(
      v.literal("refresh_repository"),
      v.literal("build_paper"),
      v.literal("refresh_all_repositories")
    ),
    attemptedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("userRateLimitAttempts", {
      userId: args.userId,
      action: args.action,
      attemptedAt: args.attemptedAt,
    });
  },
});

export const upsertUserRateLimitLock = internalMutation({
  args: {
    lockId: v.optional(v.id("userRateLimitLocks")),
    userId: v.id("users"),
    action: v.union(
      v.literal("refresh_repository"),
      v.literal("build_paper"),
      v.literal("refresh_all_repositories")
    ),
    lockedUntil: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.lockId) {
      await ctx.db.patch(args.lockId, { lockedUntil: args.lockedUntil });
      return;
    }
    await ctx.db.insert("userRateLimitLocks", {
      userId: args.userId,
      action: args.action,
      lockedUntil: args.lockedUntil,
    });
  },
});

export const deleteUserRateLimitLock = internalMutation({
  args: {
    id: v.id("userRateLimitLocks"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Internal action for rate limit checking (avoid OCC on attempts table)
export const checkAndRecordRateLimit = internalAction({
  args: {
    userId: v.id("users"),
    action: v.union(
      v.literal("refresh_repository"),
      v.literal("build_paper"),
      v.literal("refresh_all_repositories"),
      v.literal("background_refresh")
    ),
  },
  handler: async (ctx, args) => {
    const config = getUserRateLimitConfig(args.action as UserRateLimitAction);
    const now = Date.now();
    const lock = await ctx.runQuery(internal.sync.getUserRateLimitLock, {
      userId: args.userId,
      action: args.action,
    });

    if (lock?.lockedUntil && now < lock.lockedUntil) {
      return { allowed: false, retryAfter: lock.lockedUntil - now };
    }

    if (lock?.lockedUntil && now >= lock.lockedUntil) {
      await ctx.runMutation(internal.sync.deleteUserRateLimitLock, { id: lock._id });
    }

    const windowStart = now - config.windowMs;
    const attemptCount = await ctx.runQuery(internal.sync.countUserRateLimitAttempts, {
      userId: args.userId,
      action: args.action,
      windowStart,
    });

    if (attemptCount >= config.max) {
      const lockedUntil = now + config.lockoutMs;
      await ctx.runMutation(internal.sync.upsertUserRateLimitLock, {
        lockId: lock?._id,
        userId: args.userId,
        action: args.action,
        lockedUntil,
      });
      return { allowed: false, retryAfter: config.lockoutMs };
    }

    await ctx.runMutation(internal.sync.insertUserRateLimitAttempt, {
      userId: args.userId,
      action: args.action,
      attemptedAt: now,
    });

    return { allowed: true, remaining: config.max - attemptCount - 1 };
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

// Try to acquire build lock for a paper - returns attempt ID if acquired, null if already building
export const tryAcquireBuildLock = internalMutation({
  args: { id: v.id("papers") },
  handler: async (ctx, args): Promise<{ acquired: boolean; attemptId: string | null }> => {
    const paper = await ctx.db.get(args.id);
    if (!paper) return { acquired: false, attemptId: null };

    const now = Date.now();

    // If already building, check if the lock has timed out
    if (paper.buildStatus === "building") {
      const lockStartTime = paper.buildLockAcquiredAt || 0;
      const timeSinceLockAcquired = now - lockStartTime;

      if (timeSinceLockAcquired < BUILD_LOCK_TIMEOUT_MS) {
        // Lock is still valid, don't allow new build
        return { acquired: false, attemptId: null };
      }
      // Lock has timed out, allow override
      console.log(`Build lock for paper ${args.id} timed out after ${timeSinceLockAcquired}ms, allowing new build`);
    }

    // Generate a new attempt ID
    const attemptId = generateAttemptId();

    // Acquire the lock by setting status to building and recording lock acquisition time
    await ctx.db.patch(args.id, {
      buildStatus: "building",
      buildLockAcquiredAt: now,
      currentBuildAttemptId: attemptId,
    });
    return { acquired: true, attemptId };
  },
});

// Validate that the given attempt ID matches the current build attempt
export const validateBuildAttempt = internalQuery({
  args: {
    paperId: v.id("papers"),
    attemptId: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return false;
    return paper.currentBuildAttemptId === args.attemptId;
  },
});

// Release build lock (set status to idle or error)
export const releaseBuildLock = internalMutation({
  args: {
    id: v.id("papers"),
    status: v.union(v.literal("idle"), v.literal("error")),
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // If attemptId is provided, validate it first
    if (args.attemptId) {
      const paper = await ctx.db.get(args.id);
      if (paper && paper.currentBuildAttemptId !== args.attemptId) {
        console.log(`Build attempt ${args.attemptId} superseded, skipping lock release`);
        return;
      }
    }
    await ctx.db.patch(args.id, { buildStatus: args.status });
  },
});

// Public mutation to reset a stuck build status (for manual intervention)
export const resetBuildStatus = mutation({
  args: { paperId: v.id("papers") },
  handler: async (ctx, args) => {
    // Verify the user owns this paper
    const authenticatedUserId = await auth.getUserId(ctx);
    if (!authenticatedUserId) {
      throw new Error("Not authenticated");
    }

    const paper = await ctx.db.get(args.paperId);
    if (!paper) {
      throw new Error("Paper not found");
    }

    // Check ownership through repository or direct upload
    if (paper.repositoryId) {
      const repo = await ctx.db.get(paper.repositoryId);
      if (!repo || repo.userId !== authenticatedUserId) {
        throw new Error("Paper not found or access denied");
      }
    } else if (paper.userId !== authenticatedUserId) {
      throw new Error("Paper not found or access denied");
    }

    // Reset the build status to idle
    await ctx.db.patch(args.paperId, { buildStatus: "idle" });
    return { success: true };
  },
});

// Internal mutation to update repository after sync
export const updateRepositoryAfterSync = internalMutation({
  args: {
    id: v.id("repositories"),
    lastCommitHash: v.string(),
    lastCommitTime: v.optional(v.number()),
    lastCommitAuthor: v.optional(v.union(v.string(), v.null())),
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

    const patchData: Record<string, unknown> = {
      lastCommitHash: args.lastCommitHash,
      lastSyncedAt: args.lastSyncedAt,
      syncStatus: args.syncStatus,
    };

    if (args.lastCommitTime !== undefined) {
      patchData.lastCommitTime = args.lastCommitTime;
    }

    if (args.lastCommitAuthor && args.lastCommitAuthor !== null) {
      patchData.lastCommitAuthor = args.lastCommitAuthor;
    }

    await ctx.db.patch(args.id, patchData);
    return { success: true };
  },
});

// Refresh a repository - fetch latest commit and check if papers need updates
// (renamed from syncRepository for clearer terminology)
export const refreshRepository = action({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Check rate limit for refresh operations
    const rateLimitResult = await ctx.runAction(internal.sync.checkAndRecordRateLimit, {
      userId,
      action: "refresh_repository",
    });
    if (!rateLimitResult.allowed) {
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(rateLimitResult.retryAfter! / 1000)} seconds.`);
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
      // Repository is already syncing - return gracefully instead of throwing
      return { updated: false, skipped: true, reason: "Repository is already syncing" };
    }

    const attemptId = lockResult.attemptId;

    try {
      // Fetch latest commit (pass knownSha to skip expensive date fetch if unchanged)
      let latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
        gitUrl: repository.gitUrl,
        branch: repository.defaultBranch,
        knownSha: repository.lastCommitHash,
      });

      if (latestCommit.unchanged && !repository.lastCommitTime) {
        latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
          gitUrl: repository.gitUrl,
          branch: repository.defaultBranch,
        });
      }

      // Convert commit date to Unix timestamp
      const commitTime = getCommitTime(latestCommit, repository.lastCommitTime);

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
          lastCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
          lastSyncedAt: Date.now(),
          syncStatus: "idle",
          attemptId,
        });
        if (!result.success) {
          console.log(`Sync attempt ${attemptId} was superseded`);
        }
        return { updated: false, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
      }

      // Validate attempt before expensive operations
      const isStillValid = await ctx.runQuery(internal.sync.validateSyncAttempt, {
        repositoryId: args.repositoryId,
        attemptId,
      });
      if (!isStillValid) {
        console.log(`Sync attempt ${attemptId} was superseded before processing papers`);
        return { updated: false, commitHash: latestCommit.sha, superseded: true, dateIsFallback: latestCommit.dateIsFallback };
      }

      // New commit detected - fetch changed files to efficiently check which papers are affected
      let changedFiles: string[] = [];
      if (repository.lastCommitHash) {
        changedFiles = await ctx.runAction(internal.git.fetchChangedFilesInternal, {
          gitUrl: repository.gitUrl,
          baseCommit: repository.lastCommitHash,
          headCommit: latestCommit.sha,
        });
        console.log(`Found ${changedFiles.length} changed files between commits`);
      }
      const changedFilesSet = new Set(changedFiles);

      // Batch load all tracked files upfront to avoid O(n) sequential queries
      const trackedFileIds = papers
        .map(p => p.trackedFileId)
        .filter((id): id is Id<"trackedFiles"> => id !== undefined);
      const trackedFiles = await ctx.runQuery(internal.sync.getTrackedFilesByIds, { ids: trackedFileIds });
      const trackedFileMap = new Map(trackedFiles.map(tf => [tf._id, tf]));

      // Process each paper
      for (const paper of papers) {
        // Skip papers without tracked files
        if (!paper.trackedFileId) continue;

        const trackedFile = trackedFileMap.get(paper.trackedFileId);

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

        // For committed PDF source type, check if the PDF file changed
        if (trackedFile && trackedFile.pdfSourceType === "committed") {
          // If we have changed files list, use it for quick check
          if (changedFiles.length > 0 && !changedFilesSet.has(trackedFile.filePath)) {
            // PDF file not in changed list - just update commit hash
            console.log(`Committed PDF not in changed files for paper ${paper._id}`);
            await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
              id: paper._id,
              cachedCommitHash: latestCommit.sha,
              repositoryId: args.repositoryId,
              attemptId,
            });
            continue;
          }

          // Fall back to blob hash check if no changed files list or file is in list
          if (paper.cachedPdfBlobHash) {
            try {
              const currentHashes = await ctx.runAction(internal.git.fetchFileHashBatchInternal, {
                gitUrl: repository.gitUrl,
                filePaths: [trackedFile.filePath],
                branch: repository.defaultBranch,
              });
              const currentPdfHash = currentHashes[trackedFile.filePath];

              if (currentPdfHash && currentPdfHash === paper.cachedPdfBlobHash) {
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
              console.log(`Could not check PDF hash for paper ${paper._id}: ${error}`);
            }
          }

          // PDF needs re-download
          await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
            id: paper._id,
            needsSync: true,
            repositoryId: args.repositoryId,
            attemptId,
          });
          continue;
        }

        // For compile source type, check if any dependency file changed
        if (trackedFile && trackedFile.pdfSourceType === "compile") {
          // If we have changed files list (GitHub/GitLab), do quick intersection check
          if (changedFiles.length > 0 && paper.cachedDependencies && paper.cachedDependencies.length > 0) {
            const hasChangedDependency = paper.cachedDependencies.some(dep => changedFilesSet.has(dep.path));

            if (!hasChangedDependency) {
              // No dependencies changed - just update commit hash
              console.log(`No dependencies changed for paper ${paper._id}`);
              await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
                id: paper._id,
                cachedCommitHash: latestCommit.sha,
                repositoryId: args.repositoryId,
                attemptId,
              });
              continue;
            }

            // At least one dependency changed - mark for rebuild and update lastAffectedCommit
            console.log(`Dependencies changed for paper ${paper._id}`);
            await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
              id: paper._id,
              needsSync: true,
              repositoryId: args.repositoryId,
              attemptId,
              lastAffectedCommitHash: latestCommit.sha,
              lastAffectedCommitTime: commitTime,
              lastAffectedCommitMessage: latestCommit.message,
              lastAffectedCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
            });
            continue;
          }

          // No changed files list (Overleaf) but we have cached deps - use hash-based check
          if (changedFiles.length === 0 && paper.cachedDependencies && paper.cachedDependencies.length > 0 && paper.pdfFileId) {
            const dependenciesChanged = await checkDependenciesChanged(
              ctx,
              repository.gitUrl,
              repository.defaultBranch,
              paper.cachedDependencies
            );

            if (!dependenciesChanged) {
              // No dependencies changed - just update commit hash
              console.log(`Dependencies unchanged (hash check) for paper ${paper._id}`);
              await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
                id: paper._id,
                cachedCommitHash: latestCommit.sha,
                repositoryId: args.repositoryId,
                attemptId,
              });
              continue;
            }

            // Dependencies changed - mark for rebuild and update lastAffectedCommit
            console.log(`Dependencies changed (hash check) for paper ${paper._id}`);
            await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
              id: paper._id,
              needsSync: true,
              repositoryId: args.repositoryId,
              attemptId,
              lastAffectedCommitHash: latestCommit.sha,
              lastAffectedCommitTime: commitTime,
              lastAffectedCommitMessage: latestCommit.message,
              lastAffectedCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
            });
            continue;
          }

          // No cached deps yet - needs initial build
        }

        // Mark paper as needing sync (no dependency info available yet)
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
        lastCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
        lastSyncedAt: Date.now(),
        syncStatus: "idle",
        attemptId,
      });

      if (!result.success) {
        console.log(`Sync attempt ${attemptId} was superseded at final update`);
        return { updated: true, commitHash: latestCommit.sha, superseded: true, dateIsFallback: latestCommit.dateIsFallback };
      }

      return { updated: true, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
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

// Update paper with PDF info using paper-level build lock
export const updatePaperPdfWithBuildLock = internalMutation({
  args: {
    id: v.id("papers"),
    pdfFileId: v.id("_storage"),
    cachedCommitHash: v.string(),
    fileSize: v.number(),
    cachedDependencies: v.optional(v.array(v.object({
      path: v.string(),
      hash: v.string(),
    }))),
    cachedPdfBlobHash: v.optional(v.string()),
    attemptId: v.optional(v.string()),
    lastAffectedCommitHash: v.optional(v.string()),
    lastAffectedCommitTime: v.optional(v.number()),
    lastAffectedCommitMessage: v.optional(v.string()),
    lastAffectedCommitAuthor: v.optional(v.union(v.string(), v.null())),
    builtFromCommitHash: v.optional(v.string()),
    builtFromCommitTime: v.optional(v.number()),
    builtFromCommitAuthor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<{ success: boolean; reason?: string }> => {
    // If attemptId is provided, validate against paper's build attempt
    if (args.attemptId) {
      const paper = await ctx.db.get(args.id);
      if (paper && paper.currentBuildAttemptId !== args.attemptId) {
        console.log(`Build attempt ${args.attemptId} superseded, skipping paper PDF update`);
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

      // Schedule cleanup of old versions (keep last 5 non-pinned + all pinned)
      await ctx.scheduler.runAfter(0, internal.papers.cleanupOldVersions, {
        paperId: args.id,
        keepCount: 5,
      });
    }

    const patchData: Record<string, unknown> = {
      pdfFileId: args.pdfFileId,
      cachedCommitHash: args.cachedCommitHash,
      fileSize: args.fileSize,
      cachedDependencies: args.cachedDependencies,
      cachedPdfBlobHash: args.cachedPdfBlobHash,
      needsSync: false,
      needsSyncSetAt: undefined,
      lastSyncError: undefined,
      buildStatus: "idle", // Clear build status on success
      updatedAt: Date.now(),
    };

    // Only update lastAffectedCommit fields if provided (when dependencies actually changed)
    if (args.lastAffectedCommitHash) {
      patchData.lastAffectedCommitHash = args.lastAffectedCommitHash;
    }
    if (args.lastAffectedCommitTime) {
      patchData.lastAffectedCommitTime = args.lastAffectedCommitTime;
    }
    if (args.lastAffectedCommitMessage) {
      patchData.lastAffectedCommitMessage = args.lastAffectedCommitMessage;
    }
    if (args.lastAffectedCommitAuthor && args.lastAffectedCommitAuthor !== null) {
      patchData.lastAffectedCommitAuthor = args.lastAffectedCommitAuthor;
    }

    // Update builtFromCommit fields (the commit used to build this PDF)
    if (args.builtFromCommitHash) {
      patchData.builtFromCommitHash = args.builtFromCommitHash;
    }
    if (args.builtFromCommitTime) {
      patchData.builtFromCommitTime = args.builtFromCommitTime;
    }
    if (args.builtFromCommitAuthor && args.builtFromCommitAuthor !== null) {
      patchData.builtFromCommitAuthor = args.builtFromCommitAuthor;
    }

    await ctx.db.patch(args.id, patchData);
    await ctx.scheduler.runAfter(0, internal.notifications.notifyBuildCompleted, {
      paperId: args.id,
      status: "success",
    });
    return { success: true };
  },
});

// Update paper build error (for paper-level locks)
export const updatePaperBuildError = internalMutation({
  args: {
    id: v.id("papers"),
    error: v.optional(v.string()),
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // If attemptId is provided, validate against paper's build attempt
    if (args.attemptId) {
      const paper = await ctx.db.get(args.id);
      if (paper && paper.currentBuildAttemptId !== args.attemptId) {
        console.log(`Skipping stale error update for paper ${args.id} (build attempt ${args.attemptId} superseded)`);
        return;
      }
    }
    await ctx.db.patch(args.id, {
      lastSyncError: args.error,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(2_000, internal.notifications.notifyBuildCompleted, {
      paperId: args.id,
      status: "failure",
      error: args.error,
      attemptId: args.attemptId,
    });
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
    buildAttemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.buildAttemptId) {
      const paper = await ctx.db.get(args.id);
      if (paper && paper.currentBuildAttemptId !== args.buildAttemptId) {
        console.log(`Skipping stale build commit update for paper ${args.id} (attempt ${args.buildAttemptId} superseded)`);
        return;
      }
    }
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
    await ctx.scheduler.runAfter(0, internal.notifications.notifyPaperUpdated, {
      paperId: args.id,
    });
  },
});

// Clear sync errors for all papers in a repository (called after successful refresh)
export const clearPaperSyncErrors = internalMutation({
  args: {
    repositoryId: v.id("repositories"),
  },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("papers")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    // Clear lastSyncError for all papers that have one
    for (const paper of papers) {
      if (paper.lastSyncError) {
        await ctx.db.patch(paper._id, { lastSyncError: undefined });
      }
    }

    return { clearedCount: papers.filter((p) => p.lastSyncError).length };
  },
});

// Update paper's needsSync flag (used during quick sync)
export const updatePaperNeedsSync = internalMutation({
  args: {
    id: v.id("papers"),
    needsSync: v.boolean(),
    repositoryId: v.optional(v.id("repositories")),
    attemptId: v.optional(v.string()),
    lastAffectedCommitHash: v.optional(v.string()),
    lastAffectedCommitTime: v.optional(v.number()),
    lastAffectedCommitMessage: v.optional(v.string()),
    lastAffectedCommitAuthor: v.optional(v.union(v.string(), v.null())),
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

    const patchData: Record<string, unknown> = {
      needsSync: args.needsSync,
      // Track when needsSync was set to true (for detecting stale flags)
      needsSyncSetAt: args.needsSync ? Date.now() : undefined,
    };

    // Update lastAffectedCommit info if provided
    if (args.lastAffectedCommitHash) {
      patchData.lastAffectedCommitHash = args.lastAffectedCommitHash;
    }
    if (args.lastAffectedCommitTime) {
      patchData.lastAffectedCommitTime = args.lastAffectedCommitTime;
    }
    if (args.lastAffectedCommitMessage) {
      patchData.lastAffectedCommitMessage = args.lastAffectedCommitMessage;
    }
    if (args.lastAffectedCommitAuthor && args.lastAffectedCommitAuthor !== null) {
      patchData.lastAffectedCommitAuthor = args.lastAffectedCommitAuthor;
    }

    await ctx.db.patch(args.id, patchData);
  },
});

// Build a single paper - compile/fetch its PDF using paper-level locks
// (renamed from syncPaper for clearer terminology, uses paper-level locks instead of repo-level)
export const buildPaper = action({
  args: {
    paperId: v.id("papers"),
    force: v.optional(v.boolean()),
    isRetry: v.optional(v.boolean()), // Internal: set when retrying after file-not-found
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Check rate limit for build operations
    const rateLimitResult = await ctx.runAction(internal.sync.checkAndRecordRateLimit, {
      userId,
      action: "build_paper",
    });
    if (!rateLimitResult.allowed) {
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(rateLimitResult.retryAfter! / 1000)} seconds.`);
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

    // Try to acquire paper-level build lock (allows concurrent builds of different papers)
    const lockResult = await ctx.runMutation(internal.sync.tryAcquireBuildLock, {
      id: args.paperId,
    });

    if (!lockResult.acquired || !lockResult.attemptId) {
      // Paper is already building - return gracefully instead of throwing
      return { updated: false, skipped: true, reason: "Paper is already building" };
    }

    const attemptId = lockResult.attemptId;

    // Clear any previous build error at the start
    await ctx.runMutation(internal.sync.updatePaperBuildError, {
      id: args.paperId,
      error: undefined,
      attemptId,
    });

    try {
      // Fetch latest commit to check if we need to update
      // Don't pass knownSha when force=true so we always get full commit info including author
      let latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
        gitUrl: repository.gitUrl,
        branch: repository.defaultBranch,
        knownSha: args.force ? undefined : repository.lastCommitHash,
      });

      if (!args.force && latestCommit.unchanged && !repository.lastCommitTime) {
        latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
          gitUrl: repository.gitUrl,
          branch: repository.defaultBranch,
        });
      }

      // Validate attempt before expensive operations
      const isStillValid = await ctx.runQuery(internal.sync.validateBuildAttempt, {
        paperId: args.paperId,
        attemptId,
      });
      if (!isStillValid) {
        console.log(`Build attempt ${attemptId} was superseded before paper build`);
        return { updated: false, commitHash: latestCommit.sha, superseded: true, dateIsFallback: latestCommit.dateIsFallback };
      }

      // Check if PDF is already cached for this commit (skip if force=true)
      if (!args.force && paper.cachedCommitHash === latestCommit.sha && paper.pdfFileId) {
        // Clear needsSync flag since we're up to date, then release lock
        await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
          id: args.paperId,
          cachedCommitHash: latestCommit.sha,
          buildAttemptId: attemptId,
        });
        await ctx.runMutation(internal.sync.releaseBuildLock, {
          id: args.paperId,
          status: "idle",
          attemptId,
        });
        return { updated: false, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
      }

      // Check if any dependency files actually changed (for compile source type)
      // Skip this check if force=true
      if (
        !args.force &&
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
            buildAttemptId: attemptId,
          });
          // Release lock
          await ctx.runMutation(internal.sync.releaseBuildLock, {
            id: args.paperId,
            status: "idle",
            attemptId,
          });
          return { updated: false, commitHash: latestCommit.sha, reason: "dependencies_unchanged", dateIsFallback: latestCommit.dateIsFallback };
        }
      }

      // Validate attempt before expensive compile/fetch operations
      const isStillValidBeforeCompile = await ctx.runQuery(internal.sync.validateBuildAttempt, {
        paperId: args.paperId,
        attemptId,
      });
      if (!isStillValidBeforeCompile) {
        console.log(`Build attempt ${attemptId} was superseded before compile/fetch`);
        return { updated: false, commitHash: latestCommit.sha, superseded: true, dateIsFallback: latestCommit.dateIsFallback };
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
          compiler: trackedFile.compiler ?? "pdflatex",
        });
        storageId = result.storageId;
        fileSize = result.size;
        dependencies = result.dependencies;
      } else {
        // Fetch committed PDF and store directly to Convex storage
        const result = await ctx.runAction(internal.git.fetchAndStoreFileInternal, {
          gitUrl: repository.gitUrl,
          filePath: trackedFile.filePath,
          branch: repository.defaultBranch,
          contentType: "application/pdf",
        });
        storageId = result.storageId;
        fileSize = result.size;

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

      // Compute commit time for last affected tracking
      const commitTime = getCommitTime(latestCommit, repository.lastCommitTime);

      // Update paper with new PDF using paper-level lock validation (also clears lastSyncError and buildStatus)
      const updateResult = await ctx.runMutation(internal.sync.updatePaperPdfWithBuildLock, {
        id: args.paperId,
        pdfFileId: storageId as Id<"_storage">,
        cachedCommitHash: latestCommit.sha,
        fileSize,
        cachedDependencies: dependencies,
        cachedPdfBlobHash: pdfBlobHash,
        attemptId,
        lastAffectedCommitHash: latestCommit.sha,
        lastAffectedCommitTime: commitTime,
        lastAffectedCommitMessage: latestCommit.message,
        lastAffectedCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
        builtFromCommitHash: latestCommit.sha,
        builtFromCommitTime: commitTime,
        builtFromCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
      });

      if (!updateResult.success) {
        console.log(`Build attempt ${attemptId} was superseded at paper PDF update`);
        try {
          await ctx.storage.delete(storageId as Id<"_storage">);
        } catch {
          // Storage file may already be deleted; ignore cleanup failure
        }
        return { updated: true, commitHash: latestCommit.sha, superseded: true, dateIsFallback: latestCommit.dateIsFallback };
      }

      // Generate thumbnail (non-blocking, errors are logged but don't fail build)
      try {
        await ctx.runAction(internal.thumbnail.generateThumbnail, {
          pdfFileId: storageId as Id<"_storage">,
          paperId: args.paperId,
        });
      } catch (error) {
        console.error("Thumbnail generation failed:", error);
      }

      return { updated: true, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
    } catch (error) {
      // Check if file was not found (deleted from repository)
      if (isFileNotFoundError(error)) {
        // For compile-type PDFs, retry once after a delay (file might be mid-rename/update)
        if (trackedFile.pdfSourceType === "compile" && !args.isRetry) {
          console.log(`File not found for compile paper ${args.paperId}, retrying in 5s...`);

          // Wait 5 seconds before retry
          await new Promise((resolve) => setTimeout(resolve, 5000));

          await ctx.runMutation(internal.sync.releaseBuildLock, {
            id: args.paperId,
            status: "idle",
            attemptId,
          });

          // Recursive call with retry flag to prevent infinite retries
          return ctx.runAction(internal.sync.buildPaper, {
            paperId: args.paperId,
            force: args.force,
            isRetry: true,
          });
        }

        const errorMessage = `Source file not found: ${error.filePath}. The file may have been deleted or renamed in the repository.`;
        await ctx.runMutation(internal.sync.updatePaperBuildError, {
          id: args.paperId,
          error: errorMessage,
          attemptId,
        });

        // Release lock with error status, but don't throw - paper keeps its last PDF
        await ctx.runMutation(internal.sync.releaseBuildLock, {
          id: args.paperId,
          status: "error",
          attemptId,
        });

        console.log(`File not found for paper ${args.paperId}: ${error.filePath}`);
        return { updated: false, fileNotFound: true, filePath: error.filePath };
      }

      // Store the error on the paper for UI display
      const errorMessage = error instanceof Error ? error.message : "Build failed";
      await ctx.runMutation(internal.sync.updatePaperBuildError, {
        id: args.paperId,
        error: errorMessage,
        attemptId,
      });

      // Release lock on failure with error status
      await ctx.runMutation(internal.sync.releaseBuildLock, {
        id: args.paperId,
        status: "error",
        attemptId,
      });
      throw error;
    }
  },
});

// Mobile version of buildPaper (internal, auth handled by HTTP layer)
export const buildPaperForMobile = internalAction({
  args: {
    paperId: v.string(),
    userId: v.string(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const paperId = args.paperId as Id<"papers">;
    const userId = args.userId as Id<"users">;

    // Check rate limit for build operations
    const rateLimitResult = await ctx.runAction(internal.sync.checkAndRecordRateLimit, {
      userId,
      action: "build_paper",
    });
    if (!rateLimitResult.allowed) {
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(rateLimitResult.retryAfter! / 1000)} seconds.`);
    }

    // Get paper and verify ownership
    const paper = await ctx.runQuery(internal.git.getPaper, { id: paperId });
    if (!paper) throw new Error("Paper not found");

    if (!paper.trackedFileId || !paper.repositoryId) {
      throw new Error("Paper is not linked to a repository");
    }

    const repository = await ctx.runQuery(internal.git.getRepository, { id: paper.repositoryId });
    if (!repository) throw new Error("Repository not found");
    if (repository.userId !== userId) {
      throw new Error("Unauthorized");
    }

    const trackedFile = await ctx.runQuery(internal.git.getTrackedFile, { id: paper.trackedFileId });
    if (!trackedFile) throw new Error("Tracked file not found");

    // Try to acquire build lock
    const lockResult = await ctx.runMutation(internal.sync.tryAcquireBuildLock, {
      id: paperId,
    });

    if (!lockResult.acquired || !lockResult.attemptId) {
      return { updated: false, skipped: true, reason: "Paper is already building" };
    }

    const attemptId = lockResult.attemptId;

    // Clear previous build error
    await ctx.runMutation(internal.sync.updatePaperBuildError, {
      id: paperId,
      error: undefined,
      attemptId,
    });

    try {
      // Fetch latest commit - pass userId for mobile auth
      let latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
        gitUrl: repository.gitUrl,
        branch: repository.defaultBranch,
        knownSha: repository.lastCommitHash,
        userId,
      });

      if (!args.force && latestCommit.unchanged && !repository.lastCommitTime) {
        latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
          gitUrl: repository.gitUrl,
          branch: repository.defaultBranch,
          userId,
        });
      }

      // Check if PDF is already cached for this commit (skip if force=true)
      if (!args.force && paper.cachedCommitHash === latestCommit.sha && paper.pdfFileId) {
        await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
          id: paperId,
          cachedCommitHash: latestCommit.sha,
          buildAttemptId: attemptId,
        });
        await ctx.runMutation(internal.sync.releaseBuildLock, {
          id: paperId,
          status: "idle",
          attemptId,
        });
        return { updated: false, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
      }

      let storageId: string;
      let fileSize: number;
      let dependencies: Array<{ path: string; hash: string }> | undefined;

      if (trackedFile.pdfSourceType === "compile") {
        const result = await ctx.runAction(internal.latex.compileLatexInternal, {
          gitUrl: repository.gitUrl,
          filePath: trackedFile.filePath,
          branch: repository.defaultBranch,
          paperId: paperId,
          userId, // Pass userId for mobile auth
          compiler: trackedFile.compiler ?? "pdflatex",
        });
        storageId = result.storageId;
        fileSize = result.size;
        dependencies = result.dependencies;
      } else {
        // Fetch committed PDF and store directly to Convex storage
        const result = await ctx.runAction(internal.git.fetchAndStoreFileInternal, {
          gitUrl: repository.gitUrl,
          filePath: trackedFile.filePath,
          branch: repository.defaultBranch,
          userId, // Pass userId for mobile auth
          contentType: "application/pdf",
        });
        storageId = result.storageId;
        fileSize = result.size;
      }

      const commitTime = getCommitTime(latestCommit, repository.lastCommitTime);

      const updateResult = await ctx.runMutation(internal.sync.updatePaperPdfWithBuildLock, {
        id: paperId,
        pdfFileId: storageId as Id<"_storage">,
        cachedCommitHash: latestCommit.sha,
        fileSize,
        cachedDependencies: dependencies,
        attemptId,
        lastAffectedCommitHash: latestCommit.sha,
        lastAffectedCommitTime: commitTime,
        lastAffectedCommitMessage: latestCommit.message,
        lastAffectedCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
        builtFromCommitHash: latestCommit.sha,
        builtFromCommitTime: commitTime,
        builtFromCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
      });

      if (!updateResult.success) {
        try {
          await ctx.storage.delete(storageId as Id<"_storage">);
        } catch {
          // Storage file may already be deleted; ignore cleanup failure
        }
        return { updated: true, commitHash: latestCommit.sha, superseded: true, dateIsFallback: latestCommit.dateIsFallback };
      }

      // Generate thumbnail
      try {
        await ctx.runAction(internal.thumbnail.generateThumbnail, {
          pdfFileId: storageId as Id<"_storage">,
          paperId: paperId,
        });
      } catch (error) {
        console.error("Thumbnail generation failed:", error);
      }

      return { updated: true, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
    } catch (error) {
      // Check if file was not found (deleted from repository)
      if (isFileNotFoundError(error)) {
        const errorMessage = `Source file not found: ${error.filePath}. The file may have been deleted or renamed in the repository.`;
        await ctx.runMutation(internal.sync.updatePaperBuildError, {
          id: paperId,
          error: errorMessage,
          attemptId,
        });
        await ctx.runMutation(internal.sync.releaseBuildLock, {
          id: paperId,
          status: "error",
          attemptId,
        });
        console.log(`File not found for paper ${paperId}: ${error.filePath}`);
        return { updated: false, fileNotFound: true, filePath: error.filePath };
      }

      const errorMessage = error instanceof Error ? error.message : "Build failed";
      await ctx.runMutation(internal.sync.updatePaperBuildError, {
        id: paperId,
        error: errorMessage,
        attemptId,
      });
      await ctx.runMutation(internal.sync.releaseBuildLock, {
        id: paperId,
        status: "error",
        attemptId,
      });
      throw error;
    }
  },
});

// Internal query to get all repositories for a user (for batch operations)
export const getUserRepositories = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// Internal query to list all repositories with background refresh enabled
export const listBackgroundRefreshRepositories = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("repositories")
      .withIndex("by_background_refresh", (q) => q.eq("backgroundRefreshEnabled", true))
      .collect();
  },
});

// Internal action to refresh a single repository without auth/rate limit checks
// Used by refreshAllRepositories for batch operations
export const refreshRepositoryInternal = internalAction({
  args: { repositoryId: v.id("repositories"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const repository = await ctx.runQuery(internal.git.getRepository, {
      id: args.repositoryId,
    });
    if (!repository || repository.userId !== args.userId) {
      return { updated: false, skipped: true, reason: "Not found or unauthorized" };
    }

    // Try to acquire sync lock (optimistic locking to prevent concurrent syncs)
    const lockResult = await ctx.runMutation(internal.sync.tryAcquireSyncLock, {
      id: args.repositoryId,
    });

    if (!lockResult.acquired || !lockResult.attemptId) {
      return { updated: false, skipped: true, reason: "Repository is already syncing" };
    }

    const attemptId = lockResult.attemptId;

    try {
      // Fetch latest commit (pass knownSha to skip expensive date fetch if unchanged)
      let latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
        gitUrl: repository.gitUrl,
        branch: repository.defaultBranch,
        knownSha: repository.lastCommitHash,
      });

      if (latestCommit.unchanged && !repository.lastCommitTime) {
        latestCommit = await ctx.runAction(internal.git.fetchLatestCommitInternal, {
          gitUrl: repository.gitUrl,
          branch: repository.defaultBranch,
        });
      }

      // Convert commit date to Unix timestamp
      const commitTime = getCommitTime(latestCommit, repository.lastCommitTime);

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
          lastCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
          lastSyncedAt: Date.now(),
          syncStatus: "idle",
          attemptId,
        });
        if (!result.success) {
          console.log(`Sync attempt ${attemptId} was superseded`);
          return { updated: false, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
        }
        await ctx.runMutation(internal.sync.clearPaperSyncErrors, {
          repositoryId: args.repositoryId,
        });
        return { updated: false, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
      }

      // Validate attempt before expensive operations
      const isStillValid = await ctx.runQuery(internal.sync.validateSyncAttempt, {
        repositoryId: args.repositoryId,
        attemptId,
      });
      if (!isStillValid) {
        console.log(`Sync attempt ${attemptId} was superseded before processing papers`);
        return { updated: false, commitHash: latestCommit.sha, superseded: true, dateIsFallback: latestCommit.dateIsFallback };
      }

      // New commit detected - fetch changed files to efficiently check which papers are affected
      let changedFiles: string[] = [];
      if (repository.lastCommitHash) {
        changedFiles = await ctx.runAction(internal.git.fetchChangedFilesInternal, {
          gitUrl: repository.gitUrl,
          baseCommit: repository.lastCommitHash,
          headCommit: latestCommit.sha,
        });
        console.log(`Found ${changedFiles.length} changed files between commits`);
      }
      const changedFilesSet = new Set(changedFiles);

      // Batch load all tracked files upfront to avoid O(n) sequential queries
      const trackedFileIds = papers
        .map(p => p.trackedFileId)
        .filter((id): id is Id<"trackedFiles"> => id !== undefined);
      const trackedFiles = await ctx.runQuery(internal.sync.getTrackedFilesByIds, { ids: trackedFileIds });
      const trackedFileMap = new Map(trackedFiles.map(tf => [tf._id, tf]));

      // Process each paper
      for (const paper of papers) {
        // Skip papers without tracked files
        if (!paper.trackedFileId) continue;

        const trackedFile = trackedFileMap.get(paper.trackedFileId);

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

        // For committed PDF source type, check if the PDF file changed
        if (trackedFile && trackedFile.pdfSourceType === "committed") {
          // If we have changed files list, use it for quick check
          if (changedFiles.length > 0 && !changedFilesSet.has(trackedFile.filePath)) {
            // PDF file not in changed list - just update commit hash
            console.log(`Committed PDF not in changed files for paper ${paper._id}`);
            await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
              id: paper._id,
              cachedCommitHash: latestCommit.sha,
              repositoryId: args.repositoryId,
              attemptId,
            });
            continue;
          }

          // Fall back to blob hash check if no changed files list or file is in list
          if (paper.cachedPdfBlobHash) {
            try {
              const currentHashes = await ctx.runAction(internal.git.fetchFileHashBatchInternal, {
                gitUrl: repository.gitUrl,
                filePaths: [trackedFile.filePath],
                branch: repository.defaultBranch,
              });
              const currentPdfHash = currentHashes[trackedFile.filePath];

              if (currentPdfHash && currentPdfHash === paper.cachedPdfBlobHash) {
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
              console.log(`Could not check PDF hash for paper ${paper._id}: ${error}`);
            }
          }

          // PDF needs re-download
          await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
            id: paper._id,
            needsSync: true,
            repositoryId: args.repositoryId,
            attemptId,
          });
          continue;
        }

        // For compile source type, check if any dependency file changed
        if (trackedFile && trackedFile.pdfSourceType === "compile") {
          // If we have changed files list (GitHub/GitLab), do quick intersection check
          if (changedFiles.length > 0 && paper.cachedDependencies && paper.cachedDependencies.length > 0) {
            const hasChangedDependency = paper.cachedDependencies.some(dep => changedFilesSet.has(dep.path));

            if (!hasChangedDependency) {
              // No dependencies changed - just update commit hash
              console.log(`No dependencies changed for paper ${paper._id}`);
              await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
                id: paper._id,
                cachedCommitHash: latestCommit.sha,
                repositoryId: args.repositoryId,
                attemptId,
              });
              continue;
            }

            // At least one dependency changed - mark for rebuild and update lastAffectedCommit
            console.log(`Dependencies changed for paper ${paper._id}`);
            await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
              id: paper._id,
              needsSync: true,
              repositoryId: args.repositoryId,
              attemptId,
              lastAffectedCommitHash: latestCommit.sha,
              lastAffectedCommitTime: commitTime,
              lastAffectedCommitMessage: latestCommit.message,
              lastAffectedCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
            });
            continue;
          }

          // Fall back to hash checking for Overleaf or when no cached dependencies
          if (paper.cachedDependencies && paper.cachedDependencies.length > 0) {
            const depsChanged = await checkDependenciesChanged(
              ctx,
              repository.gitUrl,
              repository.defaultBranch,
              paper.cachedDependencies
            );

            if (!depsChanged) {
              console.log(`Dependencies unchanged for paper ${paper._id} (hash check)`);
              await ctx.runMutation(internal.sync.updatePaperCommitOnly, {
                id: paper._id,
                cachedCommitHash: latestCommit.sha,
                repositoryId: args.repositoryId,
                attemptId,
              });
              continue;
            }

            // Dependencies changed - mark for rebuild
            console.log(`Dependencies changed for paper ${paper._id} (hash check)`);
            await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
              id: paper._id,
              needsSync: true,
              repositoryId: args.repositoryId,
              attemptId,
              lastAffectedCommitHash: latestCommit.sha,
              lastAffectedCommitTime: commitTime,
              lastAffectedCommitMessage: latestCommit.message,
              lastAffectedCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
            });
            continue;
          }

          // No cached dependencies - needs full rebuild
          await ctx.runMutation(internal.sync.updatePaperNeedsSync, {
            id: paper._id,
            needsSync: true,
            repositoryId: args.repositoryId,
            attemptId,
          });
          continue;
        }

        // For artifact/release source types or unknown, mark as needing sync
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
        lastCommitAuthor: getCommitAuthor(latestCommit, repository.lastCommitAuthor),
        lastSyncedAt: Date.now(),
        syncStatus: "idle",
        attemptId,
      });

      if (!result.success) {
        console.log(`Sync attempt ${attemptId} was superseded at final update`);
        return { updated: true, commitHash: latestCommit.sha, superseded: true, dateIsFallback: latestCommit.dateIsFallback };
      }

      await ctx.runMutation(internal.sync.clearPaperSyncErrors, {
        repositoryId: args.repositoryId,
      });

      return { updated: true, commitHash: latestCommit.sha, dateIsFallback: latestCommit.dateIsFallback };
    } catch (error) {
      // Release lock on failure
      await ctx.runMutation(internal.sync.releaseSyncLock, {
        id: args.repositoryId,
        status: "idle",
        attemptId,
      });
      throw error;
    }
  },
});

// Minimum sync interval (in milliseconds)
const MIN_SYNC_INTERVAL = 10000;

// Batch refresh all repositories for a user - much faster than individual calls
// Does auth and rate limit check once, then processes all repos in parallel
export const refreshAllRepositories = action({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Single rate limit check for the batch operation
    const rateLimitResult = await ctx.runAction(internal.sync.checkAndRecordRateLimit, {
      userId,
      action: "refresh_all_repositories",
    });
    if (!rateLimitResult.allowed) {
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(rateLimitResult.retryAfter! / 1000)} seconds.`);
    }

    // Fetch all repositories at once
    const repositories = await ctx.runQuery(internal.sync.getUserRepositories, { userId });

    if (repositories.length === 0) {
      return { total: 0, updated: 0, failed: 0, skipped: 0 };
    }

    // Filter repos that aren't already syncing and haven't been synced recently
    const reposToCheck = repositories.filter((repo: Doc<"repositories">) => {
      if (repo.syncStatus === "syncing") return false;
      if (args.force) return true;
      if (repo.lastSyncedAt && Date.now() - repo.lastSyncedAt < MIN_SYNC_INTERVAL) {
        return false;
      }
      return true;
    });
    const skippedDueToInterval = repositories.length - reposToCheck.length;

    // Process all repos in parallel using the internal action
    const results = await Promise.allSettled(
      reposToCheck.map((repo: Doc<"repositories">) =>
        ctx.runAction(internal.sync.refreshRepositoryInternal, {
          repositoryId: repo._id,
          userId,
        })
      )
    );

    // Tally results
    let updated = 0;
    let failed = 0;
    let skipped = 0;
    let datesFallback = 0;

    for (const result of results) {
      if (result.status === "rejected") {
        failed++;
        console.error("Repository refresh failed:", result.reason);
      } else if (result.value.skipped) {
        skipped++;
      } else {
        if (result.value.updated) {
          updated++;
        }
        if (result.value.dateIsFallback) {
          datesFallback++;
        }
      }
    }

    return {
      total: repositories.length,
      checked: reposToCheck.length,
      updated,
      failed,
      skipped: skipped + skippedDueToInterval,
      datesFallback,
    };
  },
});

// Internal action for refreshing all repositories (mobile) - takes userId
export const refreshAllRepositoriesForMobile = internalAction({
  args: {
    userId: v.id("users"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Fetch all repositories at once
    const repositories = await ctx.runQuery(internal.sync.getUserRepositories, { userId: args.userId });

    if (repositories.length === 0) {
      return { checked: 0, updated: 0, failed: 0 };
    }

    // Filter repos that aren't already syncing and haven't been synced recently
    const reposToCheck = repositories.filter((repo: Doc<"repositories">) => {
      if (repo.syncStatus === "syncing") return false;
      if (args.force) return true;
      if (repo.lastSyncedAt && Date.now() - repo.lastSyncedAt < MIN_SYNC_INTERVAL) {
        return false;
      }
      return true;
    });

    // Process all repos in parallel using the internal action
    const results = await Promise.allSettled(
      reposToCheck.map((repo: Doc<"repositories">) =>
        ctx.runAction(internal.sync.refreshRepositoryInternal, {
          repositoryId: repo._id,
          userId: args.userId,
        })
      )
    );

    // Tally results
    let updated = 0;
    let failed = 0;

    for (const result of results) {
      if (result.status === "rejected") {
        failed++;
        console.error("Repository refresh failed:", result.reason);
      } else if (!result.value.skipped && result.value.updated) {
        updated++;
      }
    }

    return {
      checked: reposToCheck.length,
      updated,
      failed,
    };
  },
});

// ==================== Background Refresh (Server-Side Cron) ====================

export const backgroundRefreshForUser = internalAction({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const rateLimitResult = await ctx.runAction(internal.sync.checkAndRecordRateLimit, {
      userId: args.userId,
      action: "background_refresh",
    });

    if (!rateLimitResult.allowed) {
      return {
        userId: args.userId,
        checked: 0,
        updated: 0,
        failed: 0,
        skipped: 0,
        rateLimited: true,
      };
    }

    const repositories = await ctx.runQuery(internal.sync.getUserRepositories, {
      userId: args.userId,
    });

    const enabledRepos = repositories.filter((repo: Doc<"repositories">) =>
      repo.backgroundRefreshEnabled === true
    );

    if (enabledRepos.length === 0) {
      return {
        userId: args.userId,
        checked: 0,
        updated: 0,
        failed: 0,
        skipped: 0,
        rateLimited: false,
      };
    }

    const reposToCheck = enabledRepos.filter((repo: Doc<"repositories">) => {
      if (repo.syncStatus === "syncing") return false;
      if (repo.lastSyncedAt && Date.now() - repo.lastSyncedAt < MIN_SYNC_INTERVAL) {
        return false;
      }
      return true;
    });

    const skippedDueToState = enabledRepos.length - reposToCheck.length;

    const results = await Promise.allSettled(
      reposToCheck.map((repo: Doc<"repositories">) =>
        ctx.runAction(internal.sync.refreshRepositoryInternal, {
          repositoryId: repo._id,
          userId: args.userId,
        })
      )
    );

    let updated = 0;
    let failed = 0;
    let skipped = skippedDueToState;

    for (const result of results) {
      if (result.status === "rejected") {
        failed++;
        console.error("Background refresh failed:", result.reason);
      } else if (result.value.skipped) {
        skipped++;
      } else if (result.value.updated) {
        updated++;
      }
    }

    return {
      userId: args.userId,
      checked: reposToCheck.length,
      updated,
      failed,
      skipped,
      rateLimited: false,
    };
  },
});

export const backgroundRefreshTick = internalAction({
  args: {},
  handler: async (ctx) => {
    const repositories = await ctx.runQuery(internal.sync.listBackgroundRefreshRepositories, {});

    if (repositories.length === 0) {
      return { usersScheduled: 0, repositories: 0 };
    }

    const uniqueUserIds = Array.from(new Set(repositories.map((repo) => repo.userId)));

    for (const userId of uniqueUserIds) {
      await ctx.scheduler.runAfter(0, internal.sync.backgroundRefreshForUser, {
        userId,
      });
    }

    return { usersScheduled: uniqueUserIds.length, repositories: repositories.length };
  },
});

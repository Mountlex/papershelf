import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Extend the users table to include GitHub access token
const extendedAuthTables = {
  ...authTables,
  users: defineTable({
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.float64()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.float64()),
    // Custom field for GitHub access token
    githubAccessToken: v.optional(v.string()),
    // Custom fields for GitLab access token with refresh support
    gitlabAccessToken: v.optional(v.string()),
    gitlabRefreshToken: v.optional(v.string()),
    gitlabTokenExpiresAt: v.optional(v.number()), // Unix timestamp when access token expires
    // Custom fields for Overleaf credentials (Basic Auth: email + Git token)
    overleafEmail: v.optional(v.string()),
    overleafToken: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
};

export default defineSchema({
  // Auth tables with extended users
  ...extendedAuthTables,

  // Self-hosted GitLab instances (multiple per user, each with a name)
  selfHostedGitLabInstances: defineTable({
    userId: v.id("users"),
    name: v.string(),                    // User-friendly name, e.g., "Work GitLab"
    url: v.string(),                     // e.g., "https://gitlab.mycompany.com"
    token: v.string(),                   // Personal Access Token
    createdAt: v.number(),
  })
    .index("by_user", ["userId"]),

  // Repositories
  repositories: defineTable({
    userId: v.id("users"),
    name: v.string(),
    gitUrl: v.string(),
    provider: v.union(
      v.literal("github"),
      v.literal("gitlab"),
      v.literal("selfhosted-gitlab"),
      v.literal("overleaf"),
      v.literal("generic")
    ),
    // Reference to which self-hosted GitLab instance this repo belongs to (if provider is selfhosted-gitlab)
    selfHostedGitLabInstanceId: v.optional(v.id("selfHostedGitLabInstances")),
    defaultBranch: v.string(),
    lastSyncedAt: v.optional(v.number()),
    syncLockAcquiredAt: v.optional(v.number()), // When sync lock was acquired (for timeout calculation)
    currentSyncAttemptId: v.optional(v.string()), // UUID to track current sync attempt (prevents stale writes)
    lastCommitHash: v.optional(v.string()),
    lastCommitTime: v.optional(v.number()), // Unix timestamp of the latest commit
    lastCommitAuthor: v.optional(v.string()), // Author name of the latest commit
    syncStatus: v.union(
      v.literal("idle"),
      v.literal("syncing"),
      v.literal("error")
    ),
  })
    .index("by_user", ["userId"])
    .index("by_git_url", ["gitUrl"]),

  // Tracked files within repositories
  trackedFiles: defineTable({
    repositoryId: v.id("repositories"),
    filePath: v.string(),
    fileType: v.union(v.literal("tex"), v.literal("pdf")),
    pdfSourceType: v.union(
      v.literal("committed"),
      v.literal("compile")
    ),
    compiler: v.optional(v.union(
      v.literal("pdflatex"),
      v.literal("xelatex"),
      v.literal("lualatex")
    )),
    isActive: v.boolean(),
  }).index("by_repository", ["repositoryId"]),

  // Paper version history (stores previous PDF versions)
  paperVersions: defineTable({
    paperId: v.id("papers"),
    commitHash: v.string(),
    commitMessage: v.optional(v.string()),
    versionCreatedAt: v.number(),
    pdfFileId: v.id("_storage"),
    thumbnailFileId: v.optional(v.id("_storage")),
    fileSize: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    pinned: v.optional(v.boolean()), // Pinned versions are preserved during cleanup
  })
    .index("by_paper", ["paperId"])
    .index("by_paper_and_commit", ["paperId", "commitHash"]),

  // Papers (the main gallery items)
  papers: defineTable({
    // For repository-linked papers
    repositoryId: v.optional(v.id("repositories")),
    trackedFileId: v.optional(v.id("trackedFiles")),

    // For direct uploads (userId is set when no repository)
    userId: v.optional(v.id("users")),

    title: v.string(),
    authors: v.optional(v.array(v.string())),

    // PDF storage
    pdfFileId: v.optional(v.id("_storage")),
    thumbnailFileId: v.optional(v.id("_storage")),
    cachedCommitHash: v.optional(v.string()),
    // For committed PDFs: cache the PDF file's git blob hash to detect actual changes
    cachedPdfBlobHash: v.optional(v.string()),

    // Metadata
    pageCount: v.optional(v.number()),
    fileSize: v.optional(v.number()),

    // Compilation progress (for UI feedback)
    compilationProgress: v.optional(v.string()),

    // Last sync error (persisted for UI feedback)
    lastSyncError: v.optional(v.string()),

    // Cached dependency hashes for file-level change detection
    cachedDependencies: v.optional(v.array(v.object({
      path: v.string(),
      hash: v.string(),
    }))),

    // Last commit that actually affected this paper's dependencies
    lastAffectedCommitHash: v.optional(v.string()),
    lastAffectedCommitTime: v.optional(v.number()),
    lastAffectedCommitMessage: v.optional(v.string()),
    lastAffectedCommitAuthor: v.optional(v.string()),

    // Commit used to build the current PDF
    builtFromCommitHash: v.optional(v.string()),
    builtFromCommitTime: v.optional(v.number()),
    builtFromCommitAuthor: v.optional(v.string()),

    // Whether this paper needs recompilation (computed during quick sync)
    needsSync: v.optional(v.boolean()),
    // Timestamp when needsSync was set to true (for detecting stale flags)
    needsSyncSetAt: v.optional(v.number()),

    // Paper-level build lock (for independent paper builds)
    buildStatus: v.optional(v.union(v.literal("idle"), v.literal("building"), v.literal("error"))),
    buildLockAcquiredAt: v.optional(v.number()),
    currentBuildAttemptId: v.optional(v.string()),

    // Sharing
    isPublic: v.boolean(),
    shareSlug: v.optional(v.string()),

    updatedAt: v.number(),
  })
    .index("by_repository", ["repositoryId"])
    .index("by_tracked_file", ["trackedFileId"])
    .index("by_user", ["userId"])
    .index("by_share_slug", ["shareSlug"])
    .index("by_public", ["isPublic"]),

  // Compilation jobs (for tracking async LaTeX compilation)
  compilationJobs: defineTable({
    paperId: v.id("papers"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    errorLog: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_paper", ["paperId"])
    .index("by_status", ["status"]),

  // Mobile authentication tokens (for JWT-based mobile app auth)
  mobileTokens: defineTable({
    userId: v.id("users"),
    // Hashed refresh token (never store raw tokens)
    refreshTokenHash: v.string(),
    // Device identifier for multi-device support
    deviceId: v.optional(v.string()),
    deviceName: v.optional(v.string()),
    // Platform info
    platform: v.optional(v.union(v.literal("ios"), v.literal("android"), v.literal("unknown"))),
    // Token lifecycle
    createdAt: v.number(),
    expiresAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    // Revocation support
    isRevoked: v.boolean(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_refresh_token_hash", ["refreshTokenHash"])
    .index("by_user_and_device", ["userId", "deviceId"]),

  // Link intents for secure OAuth account linking (prevents CSRF/tampering)
  linkIntents: defineTable({
    userId: v.id("users"),
    provider: v.union(v.literal("github"), v.literal("gitlab")),
    intentToken: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    used: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["intentToken"]),

  // Email rate limits for auth operations
  emailRateLimits: defineTable({
    email: v.string(),
    action: v.union(
      v.literal("otp_send"),
      v.literal("otp_verify"),
      v.literal("password_reset"),
      v.literal("signup")
    ),
    attempts: v.number(),
    windowStart: v.number(),
    lastAttempt: v.number(),
    lockedUntil: v.optional(v.number()),
  })
    .index("by_email_action", ["email", "action"]),

  // User rate limits for compute-intensive operations
  userRateLimits: defineTable({
    userId: v.id("users"),
    action: v.union(
      v.literal("refresh_repository"),
      v.literal("build_paper"),
      v.literal("refresh_all_repositories")
    ),
    attempts: v.number(),
    windowStart: v.number(),
    lastAttempt: v.number(),
    lockedUntil: v.optional(v.number()),
  })
    .index("by_user_action", ["userId", "action"]),

  // Password change codes for authenticated users
  passwordChangeCodes: defineTable({
    userId: v.id("users"),
    codeHash: v.string(),
    expiresAt: v.number(),
    used: v.boolean(),
  })
    .index("by_user", ["userId"]),

  // Audit logs for sensitive auth operations
  auditLogs: defineTable({
    userId: v.id("users"),
    action: v.union(
      v.literal("account_merge"),
      v.literal("provider_link"),
      v.literal("password_reset"),
      v.literal("session_invalidate"),
      v.literal("token_revoke")
    ),
    targetUserId: v.optional(v.id("users")),
    metadata: v.optional(v.string()),
    timestamp: v.number(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_timestamp", ["timestamp"]),
});

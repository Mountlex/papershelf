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
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
};

export default defineSchema({
  // Auth tables with extended users
  ...extendedAuthTables,

  // Repositories
  repositories: defineTable({
    userId: v.id("users"),
    name: v.string(),
    gitUrl: v.string(),
    provider: v.union(
      v.literal("github"),
      v.literal("gitlab"),
      v.literal("overleaf"),
      v.literal("generic")
    ),
    defaultBranch: v.string(),
    lastSyncedAt: v.optional(v.number()),
    lastCommitHash: v.optional(v.string()),
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
      v.literal("artifact"),
      v.literal("release"),
      v.literal("compile")
    ),
    artifactPattern: v.optional(v.string()),
    releasePattern: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_repository", ["repositoryId"]),

  // Papers (the main gallery items)
  papers: defineTable({
    repositoryId: v.id("repositories"),
    trackedFileId: v.id("trackedFiles"),
    title: v.string(),
    authors: v.optional(v.array(v.string())),
    abstract: v.optional(v.string()),

    // PDF caching with commit tracking
    pdfFileId: v.optional(v.id("_storage")),
    thumbnailFileId: v.optional(v.id("_storage")),
    cachedCommitHash: v.optional(v.string()),

    // Metadata
    pageCount: v.optional(v.number()),
    fileSize: v.optional(v.number()),

    // Sharing
    isPublic: v.boolean(),
    shareSlug: v.optional(v.string()),

    updatedAt: v.number(),
  })
    .index("by_repository", ["repositoryId"])
    .index("by_tracked_file", ["trackedFileId"])
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
});

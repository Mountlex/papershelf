import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Paper = Doc<"papers">;
type Repository = Doc<"repositories">;
type TrackedFile = Doc<"trackedFiles">;

/**
 * Determines if a paper is up-to-date with its repository.
 *
 * @returns
 *   - `null` if paper has no repository (uploaded PDF)
 *   - `true` if paper is up-to-date
 *   - `false` if paper needs sync
 */
export function determineIfUpToDate(
  paper: Paper,
  repository: Repository | null
): boolean | null {
  // No repository means it's an uploaded PDF - no sync concept
  if (!paper.repositoryId || !repository) {
    return null;
  }

  // Paper has repo but hasn't been synced yet (no PDF)
  if (!paper.pdfFileId) {
    return false;
  }

  // Paper has been explicitly marked as needing sync (dependencies changed)
  if (paper.needsSync === true) {
    return false;
  }

  // Paper has been explicitly marked as up-to-date
  if (paper.needsSync === false) {
    return true;
  }

  // Fallback to commit hash comparison (for papers without needsSync set)
  if (repository.lastCommitHash) {
    return paper.cachedCommitHash === repository.lastCommitHash;
  }

  // Repository hasn't been synced yet
  return false;
}

interface OwnershipCheckResult {
  hasAccess: boolean;
}

/**
 * Checks if a user has ownership of a paper.
 * A paper can be owned either:
 * - Directly via userId field
 * - Indirectly via repository ownership
 *
 * @param paper The paper to check ownership for
 * @param authenticatedUserId The user ID to check against
 * @param repository The paper's repository (if any) - must be pre-fetched
 * @returns Object indicating if user has access
 */
export function checkPaperOwnership(
  paper: Paper,
  authenticatedUserId: Id<"users">,
  repository: Repository | null
): OwnershipCheckResult {
  let hasValidOwnership = false;

  // Check direct ownership via userId
  if (paper.userId) {
    if (paper.userId !== authenticatedUserId) {
      return { hasAccess: false };
    }
    hasValidOwnership = true;
  }

  // Check ownership via repository
  if (paper.repositoryId) {
    if (!repository || repository.userId !== authenticatedUserId) {
      return { hasAccess: false };
    }
    hasValidOwnership = true;
  }

  // If neither userId nor repositoryId is set, deny access (orphaned paper)
  return { hasAccess: hasValidOwnership };
}

/**
 * Generates a URL-friendly share slug from a paper title.
 * Combines a slugified title with a random suffix for uniqueness.
 * @param title - The paper title to slugify
 * @returns A unique slug string
 */
export function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").substring(0, 12);
  return `${base}-${randomSuffix}`;
}

/**
 * Result type for paper authorization checks with repository pre-fetching.
 */
export interface PaperAuthResult {
  paper: Paper;
  repository: Repository | null;
  hasAccess: boolean;
}

/**
 * Fetches a paper and verifies ownership, returning both the paper and repository.
 * This is a convenience function that combines fetching with authorization.
 *
 * For mutations, throws an error if access is denied.
 * For queries, call this and check hasAccess to decide whether to return data.
 *
 * @param ctx - The Convex context
 * @param paperId - The paper ID to fetch
 * @param userId - The authenticated user's ID
 * @returns Paper, repository, and access status
 */
export async function fetchPaperWithAuth(
  ctx: QueryCtx | MutationCtx,
  paperId: Id<"papers">,
  userId: Id<"users">
): Promise<PaperAuthResult | null> {
  const paper = await ctx.db.get(paperId);
  if (!paper) {
    return null;
  }

  const repository = paper.repositoryId
    ? await ctx.db.get(paper.repositoryId)
    : null;

  const { hasAccess } = checkPaperOwnership(paper, userId, repository);

  return { paper, repository, hasAccess };
}

/**
 * Enriched paper data with URLs and lookup maps.
 * Used internally by list functions.
 */
export interface EnrichedPaperData {
  paper: Paper;
  repository: Repository | null;
  trackedFile: TrackedFile | null;
  thumbnailUrl: string | null;
  pdfUrl: string | null;
  isUpToDate: boolean | null;
}

/**
 * Result of fetching user papers with all lookup data.
 */
export interface FetchUserPapersResult {
  papers: EnrichedPaperData[];
  repositories: Repository[];
}

export interface FetchUserPapersBaseResult {
  papers: Paper[];
  repositories: Repository[];
  trackedFileMap: Map<Id<"trackedFiles">, TrackedFile>;
  repositoryMap: Map<Id<"repositories">, Repository>;
}

/**
 * Fetches all papers for a user (via repositories + direct uploads) and enriches them
 * with storage URLs and lookup data. Used by both list() and listForMobile().
 *
 * @param ctx - The Convex context
 * @param userId - The user ID to fetch papers for
 * @returns Enriched papers with repositories, tracked files, and storage URLs
 */
export async function fetchUserPapers(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
): Promise<FetchUserPapersResult> {
  const base = await fetchUserPapersBase(ctx, userId);
  const thumbnailIds = base.papers.filter((p) => p.thumbnailFileId).map((p) => p.thumbnailFileId!);
  const pdfIds = base.papers.filter((p) => p.pdfFileId).map((p) => p.pdfFileId!);

  const [thumbnailUrls, pdfUrls] = await Promise.all([
    Promise.all(thumbnailIds.map((id) => ctx.storage.getUrl(id))),
    Promise.all(pdfIds.map((id) => ctx.storage.getUrl(id))),
  ]);

  const thumbnailUrlMap = new Map(thumbnailIds.map((id, i) => [id, thumbnailUrls[i]]));
  const pdfUrlMap = new Map(pdfIds.map((id, i) => [id, pdfUrls[i]]));

  const enrichedPapers: EnrichedPaperData[] = base.papers.map((paper) => {
    const repository = paper.repositoryId ? base.repositoryMap.get(paper.repositoryId) ?? null : null;
    const trackedFile = paper.trackedFileId ? base.trackedFileMap.get(paper.trackedFileId) ?? null : null;
    const thumbnailUrl = paper.thumbnailFileId ? thumbnailUrlMap.get(paper.thumbnailFileId) ?? null : null;
    const pdfUrl = paper.pdfFileId ? pdfUrlMap.get(paper.pdfFileId) ?? null : null;
    const isUpToDate = determineIfUpToDate(paper, repository);

    return { paper, repository, trackedFile, thumbnailUrl, pdfUrl, isUpToDate };
  });

  return { papers: enrichedPapers, repositories: base.repositories };
}

export async function fetchUserPapersBase(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
): Promise<FetchUserPapersBaseResult> {
  const repositories = await ctx.db
    .query("repositories")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const [repoPapersArrays, directUploads] = await Promise.all([
    Promise.all(
      repositories.map((repo) =>
        ctx.db
          .query("papers")
          .withIndex("by_repository", (q) => q.eq("repositoryId", repo._id))
          .collect()
      )
    ),
    ctx.db
      .query("papers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  ]);

  const directUploadsOnly = directUploads.filter((paper) => !paper.repositoryId);
  const papers = [...repoPapersArrays.flat(), ...directUploadsOnly];

  const trackedFileIds = [
    ...new Set(papers.filter((p) => p.trackedFileId).map((p) => p.trackedFileId!)),
  ];
  const trackedFilesArray = await Promise.all(
    trackedFileIds.map((id) => ctx.db.get(id))
  );
  const trackedFileMap = new Map(
    trackedFilesArray
      .filter((tf): tf is NonNullable<typeof tf> => tf !== null)
      .map((tf) => [tf._id, tf])
  );

  const repositoryMap = new Map(repositories.map((r) => [r._id, r]));

  return {
    papers,
    repositories,
    trackedFileMap,
    repositoryMap,
  };
}

/**
 * Sorts papers by last affected time, falling back to updatedAt.
 */
export function sortPapersByTime<T extends { lastAffectedCommitTime?: number; updatedAt: number }>(
  papers: T[]
): T[] {
  return papers.sort((a, b) => {
    const aTime = a.lastAffectedCommitTime ?? a.updatedAt;
    const bTime = b.lastAffectedCommitTime ?? b.updatedAt;
    return bTime - aTime;
  });
}

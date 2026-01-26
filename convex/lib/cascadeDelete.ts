import type { MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";

/**
 * Deletes a single paper and all associated data:
 * - Paper versions and their storage files
 * - Compilation jobs
 * - Paper's PDF and thumbnail storage files
 * - The paper record itself
 *
 * Does NOT delete the tracked file - caller should handle that if needed.
 */
export async function deletePaperAndAssociatedData(
  ctx: MutationCtx,
  paper: Doc<"papers">
): Promise<{ versionsDeleted: number; jobsDeleted: number; storageFilesDeleted: number }> {
  const storageIdsToDelete: Id<"_storage">[] = [];
  let versionsDeleted = 0;
  let jobsDeleted = 0;

  // Delete paper versions and collect their storage IDs
  const versions = await ctx.db
    .query("paperVersions")
    .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
    .collect();

  for (const version of versions) {
    if (version.pdfFileId) storageIdsToDelete.push(version.pdfFileId);
    if (version.thumbnailFileId) storageIdsToDelete.push(version.thumbnailFileId);
    await ctx.db.delete(version._id);
  }
  versionsDeleted = versions.length;

  // Delete compilation jobs
  const jobs = await ctx.db
    .query("compilationJobs")
    .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
    .collect();

  for (const job of jobs) {
    await ctx.db.delete(job._id);
  }
  jobsDeleted = jobs.length;

  // Collect paper's storage IDs
  if (paper.pdfFileId) storageIdsToDelete.push(paper.pdfFileId);
  if (paper.thumbnailFileId) storageIdsToDelete.push(paper.thumbnailFileId);

  // Delete storage files in parallel (with error handling for already-deleted files)
  await Promise.all(
    storageIdsToDelete.map(async (storageId) => {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // Storage file may already be deleted, continue
      }
    })
  );

  // Delete the paper
  await ctx.db.delete(paper._id);

  return {
    versionsDeleted,
    jobsDeleted,
    storageFilesDeleted: storageIdsToDelete.length,
  };
}

/**
 * Deletes multiple repositories and all associated data:
 * - Tracked files
 * - Papers (via deletePaperAndAssociatedData)
 * - Repository records
 *
 * Returns counts of deleted items for auditing.
 */
export async function deleteRepositoriesAndData(
  ctx: MutationCtx,
  repositories: Array<{ _id: Id<"repositories"> }>
): Promise<Record<string, number>> {
  const deletedCounts: Record<string, number> = {
    trackedFiles: 0,
    papers: 0,
    paperVersions: 0,
    compilationJobs: 0,
    storageFiles: 0,
    repositories: 0,
  };

  for (const repo of repositories) {
    // Delete tracked files for this repository
    const trackedFiles = await ctx.db
      .query("trackedFiles")
      .withIndex("by_repository", (q) => q.eq("repositoryId", repo._id))
      .collect();

    for (const file of trackedFiles) {
      await ctx.db.delete(file._id);
    }
    deletedCounts.trackedFiles += trackedFiles.length;

    // Get and delete all papers for this repository
    const papers = await ctx.db
      .query("papers")
      .withIndex("by_repository", (q) => q.eq("repositoryId", repo._id))
      .collect();

    for (const paper of papers) {
      const result = await deletePaperAndAssociatedData(ctx, paper);
      deletedCounts.paperVersions += result.versionsDeleted;
      deletedCounts.compilationJobs += result.jobsDeleted;
      deletedCounts.storageFiles += result.storageFilesDeleted;
    }
    deletedCounts.papers += papers.length;

    // Delete the repository
    await ctx.db.delete(repo._id);
  }
  deletedCounts.repositories = repositories.length;

  return deletedCounts;
}

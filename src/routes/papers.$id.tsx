import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createFileRoute("/papers/$id")({
  component: PaperDetailPage,
});

function PaperDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const paper = useQuery(api.papers.get, { id: id as Id<"papers"> });
  const togglePublic = useMutation(api.papers.togglePublic);
  const deletePaper = useMutation(api.papers.deletePaper);
  const syncPaper = useAction(api.sync.syncPaper);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSync = async () => {
    if (!paper) return;
    setIsSyncing(true);
    setSyncError(null);
    try {
      await syncPaper({ paperId: paper._id });
    } catch (error) {
      console.error("Failed to sync paper:", error);
      setSyncError(error instanceof Error ? error.message : "Failed to sync");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTogglePublic = async () => {
    if (!paper) return;
    try {
      await togglePublic({ id: paper._id });
    } catch (error) {
      console.error("Failed to toggle public status:", error);
    }
  };

  const handleDelete = async () => {
    if (!paper) return;
    try {
      await deletePaper({ id: paper._id });
      navigate({ to: "/" });
    } catch (error) {
      console.error("Failed to delete paper:", error);
    }
  };

  if (paper === undefined) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500 dark:text-gray-400">Loading paper...</div>
      </div>
    );
  }

  if (paper === null) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Paper not found</h2>
        <Link to="/" className="mt-4 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
          Back to Gallery
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <svg
            className="mr-1 h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Gallery
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* PDF Preview */}
        <div className="lg:col-span-2">
          <div className="aspect-[8.5/11] w-full overflow-hidden rounded-lg border bg-gray-100 shadow-sm dark:border-gray-800 dark:bg-gray-800">
            {paper.pdfUrl ? (
              <iframe
                src={paper.pdfUrl}
                className="h-full w-full"
                title={paper.title}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg
                    className="mx-auto h-16 w-16"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="mt-2 text-sm">No PDF available</p>
                  <p className="mb-4 text-xs text-gray-400">
                    {paper.trackedFile?.pdfSourceType === "compile"
                      ? "Click Sync to compile LaTeX and generate PDF"
                      : "Click Sync to fetch the PDF from the repository"}
                  </p>
                  <button
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <span className="flex items-center">
                        <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {paper.trackedFile?.pdfSourceType === "compile" ? "Compiling..." : "Syncing..."}
                      </span>
                    ) : "Sync Now"}
                  </button>
                  {isSyncing && paper.compilationProgress && (
                    <p className="mt-2 text-xs text-blue-600">{paper.compilationProgress}</p>
                  )}
                  {syncError && (
                    <p className="mt-2 text-xs text-red-500">{syncError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Paper Details */}
        <div className="space-y-6">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-gray-900 dark:text-gray-100">{paper.title}</h1>
            {paper.authors && paper.authors.length > 0 && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Authors: {paper.authors.join(", ")}
              </p>
            )}
            {paper.abstract && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{paper.abstract}</p>
            )}
          </div>

          <div className="rounded-lg border bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Details</h3>
            <dl className="space-y-2 text-sm">
              {paper.repository && (
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Repository</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{paper.repository.name}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Status</dt>
                <dd>
                  {(syncError || paper.lastSyncError) ? (
                    <span
                      className="inline-flex items-center gap-1 text-red-600"
                      title={syncError || paper.lastSyncError}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {paper.trackedFile?.pdfSourceType === "compile" ? "Compilation failed" : "Sync failed"}
                    </span>
                  ) : !paper.repository ? (
                    <span className="inline-flex items-center gap-1 text-purple-600">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Uploaded
                    </span>
                  ) : paper.isUpToDate === true ? (
                    <span className="inline-flex items-center gap-1 text-green-600">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Up to date
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-yellow-600">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Needs sync
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Last updated</dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {new Date(paper.updatedAt).toLocaleDateString()}
                </dd>
              </div>
              {paper.pageCount && (
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Pages</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{paper.pageCount}</dd>
                </div>
              )}
              {paper.fileSize && (
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Size</dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {(paper.fileSize / 1024 / 1024).toFixed(2)} MB
                  </dd>
                </div>
              )}
              {paper.cachedCommitHash && (
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Commit</dt>
                  <dd className="font-mono text-xs text-gray-900 dark:text-gray-100">
                    {paper.cachedCommitHash.slice(0, 7)}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isSyncing ? (
                <span className="flex items-center justify-center">
                  <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {paper.trackedFile?.pdfSourceType === "compile" ? "Compiling..." : "Syncing..."}
                </span>
              ) : (
                paper.pdfUrl ? "Refresh PDF" : (paper.trackedFile?.pdfSourceType === "compile" ? "Compile LaTeX" : "Fetch PDF")
              )}
            </button>
            {/* Compilation Progress */}
            {isSyncing && paper.compilationProgress && (
              <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                {paper.compilationProgress}
              </div>
            )}
            {syncError && (
              <p className="text-xs text-red-500">{syncError}</p>
            )}
            {paper.pdfUrl && (
              <a
                href={paper.pdfUrl}
                download
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Download PDF
              </a>
            )}
            {paper.pdfUrl && (
              <a
                href={paper.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                View Full Screen
              </a>
            )}
            <button
              onClick={handleTogglePublic}
              className={`w-full rounded-md border px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                paper.isPublic
                  ? "border-green-300 text-green-700 hover:bg-green-50 focus:ring-green-500 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/30"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {paper.isPublic ? "Make Private" : "Make Public"}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              Delete Paper
            </button>
          </div>

          {/* Share Link */}
          {paper.isPublic && paper.shareSlug && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <h3 className="mb-2 text-sm font-semibold text-green-900 dark:text-green-100">
                Share Link
              </h3>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/share/${paper.shareSlug}`}
                  className="flex-1 rounded border border-green-300 bg-white px-2 py-1 text-xs dark:border-green-700 dark:bg-green-900/50 dark:text-green-100"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${window.location.origin}/share/${paper.shareSlug}`
                    );
                  }}
                  className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {/* Tracked File Info */}
          {paper.trackedFile && (
            <div className="rounded-lg border bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Source
              </h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">File</dt>
                  <dd className="font-mono text-xs text-gray-900 dark:text-gray-100">
                    {paper.trackedFile.filePath}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Type</dt>
                  <dd className="text-gray-900 capitalize dark:text-gray-100">
                    {paper.trackedFile.pdfSourceType}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Delete Paper</h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Are you sure you want to delete this paper? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

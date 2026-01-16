import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createFileRoute("/papers/$id")({
  component: PaperDetailPage,
});

function PaperDetailPage() {
  const { id } = Route.useParams();
  const paper = useQuery(api.papers.get, { id: id as Id<"papers"> });
  const togglePublic = useMutation(api.papers.togglePublic);
  const syncPaper = useAction(api.sync.syncPaper);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

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

  if (paper === undefined) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading paper...</div>
      </div>
    );
  }

  if (paper === null) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-lg font-medium text-gray-900">Paper not found</h2>
        <Link to="/" className="mt-4 text-blue-600 hover:text-blue-700">
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
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
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
          <div className="aspect-[8.5/11] w-full overflow-hidden rounded-lg border bg-gray-100 shadow-sm">
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
                    {isSyncing ? "Syncing..." : "Sync Now"}
                  </button>
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
            <h1 className="text-2xl font-bold text-gray-900">{paper.title}</h1>
            {paper.authors && paper.authors.length > 0 && (
              <p className="mt-2 text-sm text-gray-600">
                Authors: {paper.authors.join(", ")}
              </p>
            )}
            {paper.abstract && (
              <p className="mt-3 text-sm text-gray-600">{paper.abstract}</p>
            )}
          </div>

          <div className="rounded-lg border bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Details</h3>
            <dl className="space-y-2 text-sm">
              {paper.repository && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Repository</dt>
                  <dd className="text-gray-900">{paper.repository.name}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">Last updated</dt>
                <dd className="text-gray-900">
                  {new Date(paper.updatedAt).toLocaleDateString()}
                </dd>
              </div>
              {paper.pageCount && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Pages</dt>
                  <dd className="text-gray-900">{paper.pageCount}</dd>
                </div>
              )}
              {paper.fileSize && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Size</dt>
                  <dd className="text-gray-900">
                    {(paper.fileSize / 1024 / 1024).toFixed(2)} MB
                  </dd>
                </div>
              )}
              {paper.cachedCommitHash && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Commit</dt>
                  <dd className="font-mono text-xs text-gray-900">
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
            {syncError && (
              <p className="text-xs text-red-500">{syncError}</p>
            )}
            {paper.pdfUrl && (
              <a
                href={paper.pdfUrl}
                download
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Download PDF
              </a>
            )}
            {paper.pdfUrl && (
              <a
                href={paper.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                View Full Screen
              </a>
            )}
            <button
              onClick={handleTogglePublic}
              className={`w-full rounded-md border px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                paper.isPublic
                  ? "border-green-300 text-green-700 hover:bg-green-50 focus:ring-green-500"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500"
              }`}
            >
              {paper.isPublic ? "Make Private" : "Make Public"}
            </button>
          </div>

          {/* Share Link */}
          {paper.isPublic && paper.shareSlug && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-green-900">
                Share Link
              </h3>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/share/${paper.shareSlug}`}
                  className="flex-1 rounded border border-green-300 bg-white px-2 py-1 text-xs"
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
            <div className="rounded-lg border bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">
                Source
              </h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">File</dt>
                  <dd className="font-mono text-xs text-gray-900">
                    {paper.trackedFile.filePath}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Type</dt>
                  <dd className="text-gray-900 capitalize">
                    {paper.trackedFile.pdfSourceType}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

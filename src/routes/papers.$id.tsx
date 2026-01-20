import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Toast, ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../hooks/useToast";
import { StatusBadge, BuildProgress, CompilationLog } from "../components/ui";
import { PdfViewer } from "../components/PdfViewer";

export const Route = createFileRoute("/papers/$id")({
  component: PaperDetailPage,
});

function PaperDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const paper = useQuery(api.papers.get, { id: id as Id<"papers"> });
  const versions = useQuery(api.papers.listVersions, { paperId: id as Id<"papers"> });
  const togglePublic = useMutation(api.papers.togglePublic);
  const deletePaper = useMutation(api.papers.deletePaper);
  const toggleVersionPinned = useMutation(api.papers.toggleVersionPinned);
  const buildPaper = useAction(api.sync.buildPaper);
  const [isLocallyBuilding, setIsLocallyBuilding] = useState(false);
  const isBuilding = isLocallyBuilding || paper?.buildStatus === "building";
  const [buildError, setBuildError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const { toast, showError, clearToast } = useToast();

  const handleBuild = async (force = false) => {
    if (!paper) return;
    setIsLocallyBuilding(true);
    setBuildError(null);
    try {
      const result = await buildPaper({ paperId: paper._id, force });
      if (result.skipped) {
        setBuildError(result.reason || "Build was skipped");
      }
    } catch (error) {
      console.error("Failed to build paper:", error);
      const isCompile = paper.trackedFile?.pdfSourceType === "compile";
      setBuildError(error instanceof Error ? error.message : (isCompile ? "Failed to compile" : "Failed to fetch"));
    } finally {
      setIsLocallyBuilding(false);
    }
  };

  const handleTogglePublic = async () => {
    if (!paper) return;
    try {
      await togglePublic({ id: paper._id });
    } catch (error) {
      console.error("Failed to toggle public status:", error);
      showError(error, "Failed to update sharing status");
    }
  };

  const handleDelete = async () => {
    if (!paper) return;
    try {
      await deletePaper({ id: paper._id });
      navigate({ to: "/" });
    } catch (error) {
      console.error("Failed to delete paper:", error);
      showError(error, "Failed to delete paper");
      setShowDeleteConfirm(false);
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
        <h2 className="text-lg font-normal text-gray-900 dark:text-gray-100">Paper not found</h2>
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
          <div className="h-[calc(100vh-12rem)] w-full overflow-hidden rounded-lg border bg-gray-100 shadow-sm dark:border-gray-800 dark:bg-gray-800">
            {paper.pdfUrl ? (
              <PdfViewer url={paper.pdfUrl} title={paper.title} />
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
                      ? "Click to compile LaTeX and generate PDF"
                      : "Click to fetch the PDF from the repository"}
                  </p>
                  <button
                    onClick={handleBuild}
                    disabled={isBuilding}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-normal text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isBuilding ? (
                      <span className="flex items-center">
                        <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {paper.trackedFile?.pdfSourceType === "compile" ? "Compiling..." : "Fetching..."}
                      </span>
                    ) : (paper.trackedFile?.pdfSourceType === "compile" ? "Compile" : "Fetch")}
                  </button>
                  {isBuilding && paper.compilationProgress && (
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">{paper.compilationProgress}</p>
                  )}
                  {buildError && (
                    <div className="mt-2">
                      <CompilationLog error={buildError} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Paper Details */}
        <div className="space-y-6">
          <div>
            <h1 className="font-serif text-2xl font-normal text-gray-900 dark:text-gray-100">{paper.title}</h1>
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
            <h3 className="mb-3 text-sm font-normal text-gray-900 dark:text-gray-100">Details</h3>
            <dl className="space-y-2 text-sm">
              {paper.repository && (
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Repository</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{paper.repository.name}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Status</dt>
                <dd className="flex items-center gap-2">
                  {paper.buildStatus === "building" ? (
                    <StatusBadge
                      status="building"
                      label={paper.trackedFile?.pdfSourceType === "compile" ? "Compiling..." : "Fetching..."}
                    />
                  ) : (buildError || paper.lastSyncError) ? (
                    <>
                      <StatusBadge
                        status="error"
                        label={paper.trackedFile?.pdfSourceType === "compile" ? "Compilation failed" : "Fetch failed"}
                        title={buildError || paper.lastSyncError || undefined}
                      />
                      <button
                        onClick={handleBuild}
                        disabled={isBuilding}
                        className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        Retry
                      </button>
                    </>
                  ) : !paper.repository ? (
                    <StatusBadge status="info" label="Uploaded" />
                  ) : paper.isUpToDate === true ? (
                    <StatusBadge status="success" label="Up to date" />
                  ) : (
                    <StatusBadge status="warning" label="Needs update" />
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

          {/* Persisted compilation error */}
          {paper.lastSyncError && !buildError && (
            <CompilationLog error={paper.lastSyncError} />
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                const isUpToDate = !!(paper.pdfUrl && !paper.needsSync);
                const isCompile = paper.trackedFile?.pdfSourceType === "compile";
                handleBuild(!!(isUpToDate && isCompile));
              }}
              disabled={isBuilding}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-normal text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isBuilding ? (
                <span className="flex items-center justify-center">
                  <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {paper.trackedFile?.pdfSourceType === "compile" ? "Compiling..." : "Fetching..."}
                </span>
              ) : (
                (() => {
                  const isCompile = paper.trackedFile?.pdfSourceType === "compile";
                  const isUpToDate = paper.pdfUrl && !paper.needsSync;
                  if (!paper.pdfUrl) return isCompile ? "Compile LaTeX" : "Fetch PDF";
                  if (isUpToDate && isCompile) return "Force Recompile";
                  return "Refresh PDF";
                })()
              )}
            </button>
            {/* Compilation Progress */}
            <BuildProgress
              status={paper.buildStatus}
              progress={paper.compilationProgress}
              isCompile={paper.trackedFile?.pdfSourceType === "compile"}
            />
            {buildError && (
              <CompilationLog error={buildError} />
            )}
            {paper.pdfUrl && (
              <a
                href={paper.pdfUrl}
                download
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-normal text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Download PDF
              </a>
            )}
            {paper.pdfUrl && (
              <a
                href={paper.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-normal text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                View Full Screen
              </a>
            )}
            <button
              onClick={handleTogglePublic}
              className={`w-full rounded-md border px-4 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                paper.isPublic
                  ? "border-green-300 text-green-700 hover:bg-green-50 focus:ring-green-500 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/30"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {paper.isPublic ? "Make Private" : "Make Public"}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-md border border-red-300 px-4 py-2 text-sm font-normal text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              Delete Paper
            </button>
          </div>

          {/* Share Link */}
          {paper.isPublic && paper.shareSlug && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <h3 className="mb-2 text-sm font-normal text-green-900 dark:text-green-100">
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
                  aria-label="Copy share link to clipboard"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {/* Tracked File Info */}
          {paper.trackedFile && (
            <div className="rounded-lg border bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-normal text-gray-900 dark:text-gray-100">
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

          {/* Version History */}
          {versions && versions.length > 0 && (
            <div className="rounded-lg border bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <button
                onClick={() => setShowVersionHistory(!showVersionHistory)}
                className="flex w-full items-center justify-between text-sm font-normal text-gray-900 dark:text-gray-100"
              >
                <span>Version History ({versions.length})</span>
                <svg
                  className={`h-4 w-4 transition-transform ${showVersionHistory ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showVersionHistory && (
                <div className="mt-3 space-y-2">
                  {/* Current version indicator */}
                  <div className="rounded border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded bg-green-600 px-1.5 py-0.5 text-xs font-normal text-white">
                          Current
                        </span>
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                          {paper.cachedCommitHash?.slice(0, 7) || "N/A"}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(paper.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Previous versions */}
                  {versions.map((version) => (
                    <div
                      key={version._id}
                      className={`rounded border p-2 ${
                        version.pinned
                          ? "border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950"
                          : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleVersionPinned({ versionId: version._id })}
                            className={`rounded p-0.5 transition-colors ${
                              version.pinned
                                ? "text-yellow-500 hover:text-yellow-600"
                                : "text-gray-400 hover:text-yellow-500"
                            }`}
                            title={version.pinned ? "Unpin version (allows auto-deletion)" : "Pin version (prevents auto-deletion)"}
                          >
                            <svg className="h-4 w-4" fill={version.pinned ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                          </button>
                          <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                            {version.commitHash.slice(0, 7)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(version.versionCreatedAt).toLocaleDateString()}
                          </span>
                          <a
                            href={version.pdfUrl || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            View
                          </a>
                        </div>
                      </div>
                      {version.fileSize && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {(version.fileSize / 1024 / 1024).toFixed(2)} MB
                          {version.pageCount && ` · ${version.pageCount} pages`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Paper"
        message="Are you sure you want to delete this paper? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={clearToast}
        />
      )}
    </div>
  );
}

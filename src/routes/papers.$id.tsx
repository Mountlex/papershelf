import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Toast, ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../hooks/useToast";
import { StatusBadge, BuildProgress, CompilationLog, PaperDetailSkeleton } from "../components/ui";
import { PdfViewer, type PdfViewerRef } from "../components/PdfViewer";
import { formatDateTime } from "../lib/formatters";

export const Route = createFileRoute("/papers/$id")({
  component: PaperDetailPage,
});

function PaperDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [isLocallyBuilding, setIsLocallyBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const paper = useQuery(api.papers.get, { id: id as Id<"papers"> });
  const selfHostedInstances = useQuery(api.users.getSelfHostedGitLabInstances, {});
  const versions = useQuery(
    api.papers.listVersions,
    showVersionHistory ? { paperId: id as Id<"papers"> } : "skip"
  );
  const togglePublic = useMutation(api.papers.togglePublic);
  const deletePaper = useMutation(api.papers.deletePaper);
  const toggleVersionPinned = useMutation(api.papers.toggleVersionPinned);
  const buildPaper = useAction(api.sync.buildPaper);
  const isBuilding = isLocallyBuilding || paper?.buildStatus === "building";
  const { toast, showError, showSuccess, clearToast } = useToast();
  const pdfViewerRef = useRef<PdfViewerRef>(null);

  const trackedFile = paper?.trackedFile ?? null;
  const compilerLabelMap: Record<string, string> = {
    pdflatex: "pdfLaTeX",
    xelatex: "XeLaTeX",
    lualatex: "LuaLaTeX",
  };
  const providerLabelMap: Record<string, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    overleaf: "Overleaf",
  };
  const compilerValue =
    trackedFile && "compiler" in trackedFile ? trackedFile.compiler : undefined;
  const compileLabel = compilerLabelMap[compilerValue ?? "pdflatex"] ?? (compilerValue ?? "pdflatex");
  const providerValue = paper?.repository?.provider ?? null;
  const selfHostedInstanceName = (() => {
    if (!paper?.repository || !selfHostedInstances) return null;
    if (paper.repository.provider !== "selfhosted-gitlab") return null;
    const instanceId = paper.repository.selfHostedGitLabInstanceId;
    if (!instanceId) return null;
    const match = selfHostedInstances.find((inst) => inst._id === instanceId);
    return match?.name ?? null;
  })();
  const providerLabel = providerValue
    ? (providerValue === "selfhosted-gitlab"
      ? (selfHostedInstanceName ?? "Self-hosted GitLab")
      : (providerLabelMap[providerValue] ?? providerValue))
    : null;

  // Check if the error indicates the source file was deleted from the repository
  const isSourceFileNotFound = (error: string | null | undefined): boolean => {
    if (!error) return false;
    return error.includes("Source file not found") || error.includes("File not found in repository");
  };

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
      showSuccess(paper.isPublic ? "Paper is now private" : "Paper is now public");
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
    return <PaperDetailSkeleton />;
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
              <PdfViewer ref={pdfViewerRef} url={paper.pdfUrl} title={paper.title} />
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
                    className="rounded-md border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-normal text-gray-900 hover:bg-primary-100 disabled:opacity-50 dark:border-primary-700 dark:bg-primary-500/20 dark:text-gray-100 dark:hover:bg-primary-500/30"
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
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                      {paper.trackedFile?.pdfSourceType === "compile" ? "Compiling: " : "Fetching: "}{paper.compilationProgress}
                    </p>
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
          </div>

          <div className="rounded-lg border bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-normal text-gray-900 dark:text-gray-100">Details</h3>
            <dl className="space-y-2 text-sm">
              {paper.pageCount && (
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Pages</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{paper.pageCount}</dd>
                </div>
              )}
              {paper.fileSize && (
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">PDF size</dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {(paper.fileSize / 1024 / 1024).toFixed(2)} MB
                  </dd>
                </div>
              )}
              {/* Show separate repo/paper commits only when we have dependency tracking */}
              {paper.repository?.lastCommitHash && paper.cachedDependencies && paper.cachedDependencies.length > 0 ? (
                <>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-500 dark:text-gray-400">Repo commit</dt>
                    <dd className="flex items-center gap-1.5 text-xs">
                      <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                        {paper.repository.lastCommitHash.slice(0, 7)}
                      </span>
                      {paper.repository?.lastCommitAuthor && (
                        <span className="text-gray-500 dark:text-gray-400 truncate max-w-32">
                          {paper.repository.lastCommitAuthor}
                        </span>
                      )}
                      {paper.repository?.lastCommitTime && (
                        <span className="text-gray-400 dark:text-gray-500">
                          {formatDateTime(paper.repository.lastCommitTime)}
                        </span>
                      )}
                    </dd>
                  </div>
                  {paper.lastAffectedCommitHash && (
                    <div className="flex justify-between items-center">
                      <dt className="text-gray-500 dark:text-gray-400">Paper commit</dt>
                      <dd className="flex items-center gap-1.5 text-xs">
                        <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                          {paper.lastAffectedCommitHash.slice(0, 7)}
                        </span>
                        {paper.lastAffectedCommitAuthor && (
                          <span className="text-gray-500 dark:text-gray-400 truncate max-w-32">
                            {paper.lastAffectedCommitAuthor}
                          </span>
                        )}
                        {paper.lastAffectedCommitTime && (
                          <span className="text-gray-400 dark:text-gray-500">
                            {formatDateTime(paper.lastAffectedCommitTime)}
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                </>
              ) : paper.repository?.lastCommitHash && (
                <div className="flex justify-between items-center">
                  <dt className="text-gray-500 dark:text-gray-400">Commit</dt>
                  <dd className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                      {paper.repository.lastCommitHash.slice(0, 7)}
                    </span>
                    {paper.repository?.lastCommitAuthor && (
                      <span className="text-gray-500 dark:text-gray-400 truncate max-w-32">
                        {paper.repository.lastCommitAuthor}
                      </span>
                    )}
                    {paper.repository?.lastCommitTime && (
                      <span className="text-gray-400 dark:text-gray-500">
                        {formatDateTime(paper.repository.lastCommitTime)}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {paper.builtFromCommitHash ? (
                <div className="flex justify-between items-center">
                  <dt className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    PDF
                    {paper.buildStatus === "building" ? (
                      <StatusBadge
                        status="building"
                        label={paper.trackedFile?.pdfSourceType === "compile" ? "Compiling..." : "Fetching..."}
                      />
                    ) : (buildError || paper.lastSyncError) ? (
                      <>
                        <StatusBadge
                          status="error"
                          label={
                            isSourceFileNotFound(buildError || paper.lastSyncError)
                              ? "Missing"
                              : "Failed"
                          }
                          title={buildError || paper.lastSyncError || undefined}
                        />
                        {paper.repository && !isSourceFileNotFound(buildError || paper.lastSyncError) && (
                          <button
                            onClick={() => handleBuild()}
                            disabled={isBuilding}
                            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Retry
                          </button>
                        )}
                      </>
                    ) : !paper.repository ? (
                      <StatusBadge status="info" label="Uploaded" />
                    ) : paper.isUpToDate === true ? (
                      <StatusBadge status="success" label="Current" />
                    ) : (
                      <StatusBadge status="warning" label="Outdated" />
                    )}
                  </dt>
                  <dd className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                      {paper.builtFromCommitHash.slice(0, 7)}
                    </span>
                    {paper.builtFromCommitAuthor && (
                      <span className="text-gray-500 dark:text-gray-400 truncate max-w-32">
                        {paper.builtFromCommitAuthor}
                      </span>
                    )}
                    {paper.builtFromCommitTime && (
                      <span className="text-gray-400 dark:text-gray-500">
                        {formatDateTime(paper.builtFromCommitTime)}
                      </span>
                    )}
                  </dd>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <dt className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    PDF
                    {paper.buildStatus === "building" ? (
                      <StatusBadge
                        status="building"
                        label={paper.trackedFile?.pdfSourceType === "compile" ? "Compiling..." : "Fetching..."}
                      />
                    ) : (buildError || paper.lastSyncError) ? (
                      <>
                        <StatusBadge
                          status="error"
                          label={
                            isSourceFileNotFound(buildError || paper.lastSyncError)
                              ? "Source missing"
                              : "Failed"
                          }
                          title={buildError || paper.lastSyncError || undefined}
                        />
                        {paper.repository && !isSourceFileNotFound(buildError || paper.lastSyncError) && (
                          <button
                            onClick={() => handleBuild()}
                            disabled={isBuilding}
                            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Retry
                          </button>
                        )}
                      </>
                    ) : !paper.repository ? (
                      <StatusBadge status="info" label="Uploaded" />
                    ) : (
                      <StatusBadge status="warning" label="Not built" />
                    )}
                  </dt>
                  <dd></dd>
                </div>
              )}
            </dl>
          </div>

          {/* Persisted compilation error */}
          {paper.lastSyncError && !buildError && (
            isSourceFileNotFound(paper.lastSyncError) ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/50">
                <div className="flex items-start gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-red-800 dark:text-red-200">Source file not found</h4>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                      The source file for this paper was deleted or renamed in the repository. You can delete this paper from your gallery.
                    </p>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="mt-3 inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:bg-red-700 dark:hover:bg-red-600"
                    >
                      <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete Paper
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <CompilationLog error={paper.lastSyncError} />
            )
          )}

          {/* Only show refresh/build controls for repository-linked papers */}
          {paper.repository && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  const isUpToDate = !!(paper.pdfUrl && !paper.needsSync);
                  const isCompile = paper.trackedFile?.pdfSourceType === "compile";
                  handleBuild(!!(isUpToDate && isCompile));
                }}
                disabled={isBuilding}
                className="w-full rounded-md border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-normal text-gray-900 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-primary-700 dark:bg-primary-500/20 dark:text-gray-100 dark:hover:bg-primary-500/30"
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
            </div>
          )}

          {/* Compact icon button bar - shown for all papers */}
          <div className="flex items-center justify-center gap-2">
              {paper.pdfUrl && (
                <a
                  href={paper.pdfUrl}
                  download
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  title="Download PDF"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </a>
              )}
              {paper.pdfUrl && (
                <button
                  onClick={() => pdfViewerRef.current?.toggleFullscreen()}
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  title="View Full Screen (F)"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </button>
              )}
              <button
                onClick={handleTogglePublic}
                className={`flex h-10 w-10 items-center justify-center rounded-md border focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  paper.isPublic
                    ? "border-green-300 text-green-700 hover:bg-green-50 focus:ring-green-500 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/30"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
                title={paper.isPublic ? "Make Private" : "Make Public"}
              >
                {paper.isPublic ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                title="Delete Paper"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
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
                    const shareUrl = `${window.location.origin}/share/${paper.shareSlug}`;

                    // Try modern Clipboard API first, fall back to execCommand
                    if (navigator.clipboard && window.isSecureContext) {
                      navigator.clipboard.writeText(shareUrl).then(() => {
                        showSuccess("Link copied to clipboard");
                      }).catch(() => {
                        showError(null, "Failed to copy link");
                      });
                    } else {
                      // Fallback for browsers without Clipboard API
                      const textArea = document.createElement("textarea");
                      textArea.value = shareUrl;
                      textArea.style.position = "fixed";
                      textArea.style.left = "-999999px";
                      textArea.style.top = "-999999px";
                      document.body.appendChild(textArea);
                      textArea.focus();
                      textArea.select();
                      try {
                        document.execCommand("copy");
                        showSuccess("Link copied to clipboard");
                      } catch {
                        showError(null, "Failed to copy link");
                      } finally {
                        document.body.removeChild(textArea);
                      }
                    }
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
                {paper.repository && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Repository</dt>
                    <dd className="text-gray-900 dark:text-gray-100">
                      {providerLabel ? `${providerLabel} / ${paper.repository.name}` : paper.repository.name}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">File</dt>
                  <dd className="font-mono text-xs text-gray-900 dark:text-gray-100">
                    {paper.trackedFile.filePath}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Type</dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {paper.trackedFile.pdfSourceType === "compile"
                      ? `Compile / ${compileLabel}`
                      : "Committed"}
                  </dd>
                </div>
                {paper.cachedDependencies && paper.cachedDependencies.length > 0 && (() => {
                  const filteredDeps = paper.cachedDependencies.filter(dep => dep.path !== paper.trackedFile?.filePath);
                  return filteredDeps.length > 0 ? (
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                      <dt className="text-gray-500 dark:text-gray-400 mb-2">Dependencies ({filteredDeps.length})</dt>
                      <dd className="max-h-32 overflow-y-auto">
                        <ul className="space-y-0.5">
                          {filteredDeps.map((dep) => (
                            <li key={dep.path} className="font-mono text-xs text-gray-600 dark:text-gray-400 truncate" title={dep.path}>
                              {dep.path}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null;
                })()}
              </dl>
            </div>
          )}

          {/* Version History */}
          <div className="rounded-lg border bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <button
              onClick={() => setShowVersionHistory(!showVersionHistory)}
              aria-expanded={showVersionHistory}
              className="flex w-full items-center justify-between text-sm font-normal text-gray-900 dark:text-gray-100"
            >
              <span>Version History</span>
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

                {versions === undefined && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">Loading versions…</div>
                )}

                {versions && versions.length === 0 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">No previous versions yet.</div>
                )}

                {/* Previous versions */}
                {versions?.map((version) => (
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
                          onClick={async () => {
                            await toggleVersionPinned({ versionId: version._id });
                            showSuccess(version.pinned ? "Version unpinned" : "Version pinned");
                          }}
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

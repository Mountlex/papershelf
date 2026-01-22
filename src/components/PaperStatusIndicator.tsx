import { LoadingSpinner } from "./ui/LoadingSpinner";

interface Repository {
  syncStatus?: string;
  lastCommitTime?: number;
  lastSyncedAt?: number;
}

interface PaperStatusIndicatorProps {
  buildStatus?: string;
  pdfSourceType?: string | null;
  compilationProgress?: string;
  isUpToDate?: boolean | null;
  lastSyncError?: string | null;
  repository: Repository | null;
  formatRelativeTime: (timestamp: number | undefined) => string;
}

export function PaperStatusIndicator({
  buildStatus,
  pdfSourceType,
  compilationProgress,
  isUpToDate,
  lastSyncError,
  repository,
  formatRelativeTime,
}: PaperStatusIndicatorProps) {
  if (!repository) return null;

  const lastTime = repository.lastCommitTime ?? repository.lastSyncedAt;

  // Building status
  if (buildStatus === "building") {
    return (
      <span
        className="flex shrink-0 items-center gap-0.5 text-blue-600"
        title={compilationProgress || (pdfSourceType === "compile" ? "Compiling LaTeX..." : "Fetching PDF...")}
      >
        <LoadingSpinner size="xs" />
        <span className="text-[10px]">
          {pdfSourceType === "compile" ? "Compiling" : "Fetching"}
        </span>
      </span>
    );
  }

  // Syncing status
  if (repository.syncStatus === "syncing") {
    return (
      <span
        className="flex shrink-0 items-center gap-0.5 text-gray-500"
        title="Checking for updates..."
      >
        <LoadingSpinner size="xs" />
        <span className="text-[10px]">Checking</span>
      </span>
    );
  }

  // Up to date
  if (isUpToDate === true) {
    return (
      <span
        className="flex shrink-0 items-center gap-0.5 text-green-600"
        title={`Up to date - committed ${formatRelativeTime(lastTime)}`}
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-[10px]">{formatRelativeTime(lastTime)}</span>
      </span>
    );
  }

  // Needs sync (no error)
  if (isUpToDate === false && !lastSyncError) {
    return (
      <span
        className="flex shrink-0 items-center gap-0.5 text-yellow-600"
        title={`New commit available - committed ${formatRelativeTime(lastTime)}`}
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span className="text-[10px]">{formatRelativeTime(lastTime)}</span>
      </span>
    );
  }

  // Error state
  if (lastSyncError) {
    // Check if the error indicates the source file was deleted
    const isSourceFileMissing = lastSyncError.includes("Source file not found") ||
      lastSyncError.includes("File not found in repository");

    return (
      <span
        className="flex shrink-0 items-center gap-0.5 text-red-600"
        title={isSourceFileMissing ? "Source file was deleted from repository" : `${pdfSourceType === "compile" ? "Compilation" : "Sync"} failed: ${lastSyncError}`}
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span className="text-[10px]">
          {isSourceFileMissing
            ? "File missing"
            : pdfSourceType === "compile"
              ? "Compilation failed"
              : "Sync failed"}
        </span>
      </span>
    );
  }

  return null;
}

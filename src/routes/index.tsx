import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "../hooks/useUser";
import { useDebounce } from "../hooks/useDebounce";
import { usePdfUpload } from "../hooks/usePdfUpload";
import type { Id } from "../../convex/_generated/dataModel";
import { Toast, ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../hooks/useToast";
import { PaperCardSkeletonGrid, LiveRegion } from "../components/ui";
import { DropZone } from "../components/DropZone";
import { PaperCard } from "../components/PaperCard";
import { FullscreenPdfOverlay } from "../components/FullscreenPdfOverlay";

export const Route = createFileRoute("/")({
  component: GalleryPage,
});

function GalleryPage() {
  const { user, isLoading: isUserLoading, isAuthenticated } = useUser();
  const papers = useQuery(api.papers.list, isAuthenticated && user ? { userId: user._id } : "skip");
  const repositories = useQuery(api.repositories.list, isAuthenticated && user ? { userId: user._id } : "skip");
  const updatePaper = useMutation(api.papers.update);
  const deletePaper = useMutation(api.papers.deletePaper);
  const refreshAllRepositories = useAction(api.sync.refreshAllRepositories);

  const [editingPaperId, setEditingPaperId] = useState<Id<"papers"> | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deletingPaperId, setDeletingPaperId] = useState<Id<"papers"> | null>(null);
  const [fullscreenPdf, setFullscreenPdf] = useState<{ url: string; title: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<{ current: number; total: number } | null>(null);
  const buildPaper = useAction(api.sync.buildPaper);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Search, sort, and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [sortBy, setSortBy] = useState<"recent" | "least-recent" | "a-z" | "repository">("recent");
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  // Toast state using hook
  const { toast, showError, showToast, clearToast } = useToast();

  // PDF upload hook
  const { isUploading, uploadFile } = usePdfUpload(user?._id, {
    onError: showError,
  });

  // Track if we've already synced on page load
  const hasSyncedOnLoad = useRef(false);

  // Focus input when editing starts
  useEffect(() => {
    if (editingPaperId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingPaperId]);

  // Keyboard shortcut for search (Cmd/Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Quick check all repositories on page load (just check for new commits, no compilation)
  useEffect(() => {
    // Check synchronously before any async work to prevent StrictMode race condition
    if (hasSyncedOnLoad.current) return;

    const shouldSync =
      repositories &&
      repositories.length > 0 &&
      !isSyncing;

    if (!shouldSync) return;

    // Set flag IMMEDIATELY, synchronously, before async work
    hasSyncedOnLoad.current = true;

    // Now start async work using the batch operation
    const runSync = async () => {
      setIsSyncing(true);

      try {
        const result = await refreshAllRepositories({});
        if (result.failed > 0) {
          showToast("Some repositories failed to check", "info");
        }
      } catch (err) {
        console.error("Auto-sync failed:", err);
      }

      setIsSyncing(false);
    };

    runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories]);

  // Filter and sort papers
  const filteredPapers = useMemo(() => {
    if (!papers) return [];

    let result = [...papers];

    // Apply search filter with debounced query
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      result = result.filter((paper) => {
        const titleMatch = paper.title.toLowerCase().includes(query);
        const authorsMatch = paper.authors?.some((author: string) =>
          author.toLowerCase().includes(query)
        );
        return titleMatch || authorsMatch;
      });
    }

    // Apply sorting
    // For uploaded papers (no repository), use _creationTime (upload date)
    // For repository papers, use lastAffectedCommitTime (when content changed)
    const getSortTime = (paper: typeof result[0]) => {
      if (paper.repository) {
        return paper.lastAffectedCommitTime ?? paper.updatedAt ?? 0;
      }
      // Uploaded paper - use creation time (upload date)
      return paper._creationTime;
    };

    result.sort((a, b) => {
      switch (sortBy) {
        case "recent": {
          return getSortTime(b) - getSortTime(a);
        }
        case "least-recent": {
          return getSortTime(a) - getSortTime(b);
        }
        case "a-z":
          return a.title.localeCompare(b.title);
        case "repository": {
          // Group by repository, then by date within each group
          const repoA = a.repository?.name ?? "";
          const repoB = b.repository?.name ?? "";
          if (repoA !== repoB) {
            // Papers with repos first, then alphabetically by repo name
            if (!repoA) return 1;
            if (!repoB) return -1;
            return repoA.localeCompare(repoB);
          }
          return getSortTime(b) - getSortTime(a);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [papers, debouncedSearchQuery, sortBy]);

  // Screen reader announcement for search results
  const searchResultsMessage = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return "";
    return `${filteredPapers.length} paper${filteredPapers.length === 1 ? "" : "s"} found`;
  }, [debouncedSearchQuery, filteredPapers.length]);

  // Handle file drop
  const handleFileDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      const result = await uploadFile(file);
      if (!result.success && result.error) {
        showToast(result.error, "error");
      }
    },
    [uploadFile, showToast]
  );

  // Handle rejected files from DropZone
  const handleFileReject = useCallback(
    (rejectedFiles: { file: File; reason: string }[]) => {
      if (rejectedFiles.length === 1) {
        showToast(`"${rejectedFiles[0].file.name}" is not a PDF file`, "error");
      } else {
        showToast(`${rejectedFiles.length} files were not PDF files`, "error");
      }
    },
    [showToast]
  );

  const clearFilters = () => {
    setSearchQuery("");
  };

  const handleStartEdit = (e: React.MouseEvent, paperId: Id<"papers">, currentTitle: string) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingPaperId(paperId);
    setEditTitle(currentTitle);
  };

  const handleSaveTitle = async () => {
    if (!editingPaperId) {
      setEditingPaperId(null);
      setEditTitle("");
      return;
    }

    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      showToast("Title cannot be empty", "error");
      return;
    }

    try {
      await updatePaper({ id: editingPaperId, title: trimmedTitle });
      showToast("Title updated", "success");
    } catch (error) {
      console.error("Failed to update title:", error);
      showError(error, "Failed to update paper title");
    }
    setEditingPaperId(null);
    setEditTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      handleSaveTitle();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setEditingPaperId(null);
      setEditTitle("");
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, paperId: Id<"papers">) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingPaperId(paperId);
  };

  const handleFullscreen = (e: React.MouseEvent, pdfUrl: string, title: string) => {
    e.preventDefault();
    e.stopPropagation();
    setFullscreenPdf({ url: pdfUrl, title });
  };

  const handleConfirmDelete = async () => {
    if (deletingPaperId) {
      try {
        await deletePaper({ id: deletingPaperId });
      } catch (error) {
        console.error("Failed to delete paper:", error);
        showError(error, "Failed to delete paper");
      }
      setDeletingPaperId(null);
    }
  };

  // Quick check all repositories (just check for new commits, no compilation)
  const handleCheckAll = async () => {
    if (!repositories || isSyncing) return;

    setIsSyncing(true);

    try {
      const result = await refreshAllRepositories({});
      if (result.failed > 0) {
        showToast(`${result.failed} ${result.failed === 1 ? "repository" : "repositories"} failed to check`, "error");
      } else if (result.checked === 0 && result.skipped > 0) {
        showToast("All repositories were recently checked", "info");
      }
    } catch (err) {
      console.error("Check all failed:", err);
      const message = err instanceof Error ? err.message : "";
      if (message.includes("Rate limit exceeded")) {
        const seconds = message.match(/(\d+) seconds/)?.[1];
        const minutes = seconds ? Math.ceil(parseInt(seconds) / 60) : 5;
        showToast(`Too many requests. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`, "info");
      } else {
        showToast("Failed to check repositories", "error");
      }
    }

    setIsSyncing(false);
  };

  // Refresh all papers that are not up to date
  const handleRefreshAll = async () => {
    if (!papers || isRefreshing) return;

    // Filter papers that are not up to date and have a repository
    const papersToRefresh = papers.filter(
      (paper) => paper.repository && paper.isUpToDate === false && paper.buildStatus !== "building"
    );

    if (papersToRefresh.length === 0) {
      showToast("All papers are up to date", "info");
      return;
    }

    setIsRefreshing(true);
    setRefreshProgress({ current: 0, total: papersToRefresh.length });

    let failedCount = 0;

    // Refresh papers in parallel
    const refreshPromises = papersToRefresh.map(async (paper) => {
      try {
        await buildPaper({ paperId: paper._id });
      } catch (err) {
        console.error(`Refresh failed for ${paper.title}:`, err);
        failedCount++;
      }
      // Use functional update to avoid race conditions
      setRefreshProgress((prev) => prev ? { ...prev, current: prev.current + 1 } : null);
    });

    await Promise.all(refreshPromises);

    setIsRefreshing(false);
    setRefreshProgress(null);

    if (failedCount > 0) {
      showToast(`${failedCount} ${failedCount === 1 ? "paper" : "papers"} failed to refresh`, "error");
    } else {
      showToast(`Refreshed ${papersToRefresh.length} ${papersToRefresh.length === 1 ? "paper" : "papers"}`, "info");
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await uploadFile(file);
    if (!result.success && result.error) {
      showToast(result.error, "error");
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Hidden file input for PDF upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Header */}
      <div className="mb-6 md:mb-8">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl font-normal text-gray-900 dark:text-gray-100">Your Papers</h1>
          <div className="flex items-center gap-1 md:gap-3">
            {/* Mobile search toggle */}
            <button
              onClick={() => setShowMobileSearch(!showMobileSearch)}
              className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-gray-50/50 p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:bg-gray-800 md:hidden"
              aria-label={showMobileSearch ? "Close search" : "Open search"}
              aria-expanded={showMobileSearch}
            >
              {showMobileSearch ? (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </button>
            {/* Search - desktop only */}
            <div className="relative hidden md:block">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search papers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-56 rounded-md border border-gray-200 bg-gray-50/50 px-3 py-2 pr-8 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-800"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Clear search"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {/* Sort - desktop only */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="hidden rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 md:block"
            >
              <option value="recent">Recent</option>
              <option value="least-recent">Least recent</option>
              <option value="a-z">A-Z</option>
              <option value="repository">By repository</option>
            </select>
            {/* Check All */}
            <button
              onClick={handleCheckAll}
              disabled={isSyncing || isRefreshing || !repositories || repositories.length === 0}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-primary-200 bg-primary-50 p-2 text-gray-900 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-primary-700 dark:bg-primary-500/20 dark:text-gray-100 dark:hover:bg-primary-500/30 md:min-w-[125px] md:px-4 md:py-2"
              title="Check all repositories for new commits"
              aria-label={isSyncing ? "Checking repositories" : "Check all repositories"}
            >
              {isSyncing ? (
                <>
                  <svg className="h-5 w-5 animate-spin md:h-4 md:w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="hidden text-sm font-normal md:inline">Checking</span>
                </>
              ) : (
                <>
                  <svg className="h-5 w-5 md:h-4 md:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="hidden text-sm font-normal md:inline">Check All</span>
                </>
              )}
            </button>
            {/* Refresh All */}
            <button
              onClick={handleRefreshAll}
              disabled={isRefreshing || isSyncing || !papers || papers.length === 0}
              className="relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-primary-200 bg-primary-50 p-2 text-gray-900 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-primary-700 dark:bg-primary-500/20 dark:text-gray-100 dark:hover:bg-primary-500/30 md:min-w-[135px] md:px-4 md:py-2"
              title="Refresh PDFs for all papers that are not up to date"
              aria-label={isRefreshing ? "Refreshing papers" : "Refresh all outdated papers"}
            >
              {isRefreshing && refreshProgress && (
                <span
                  className="absolute inset-0 bg-primary-200 dark:bg-primary-800/40 transition-all duration-300"
                  style={{ width: `${(refreshProgress.current / refreshProgress.total) * 100}%` }}
                />
              )}
              <span className="relative flex items-center gap-2">
                {isRefreshing ? (
                  <>
                    <svg className="h-5 w-5 animate-spin md:h-4 md:w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="hidden text-sm font-normal md:inline">
                      {refreshProgress ? `${refreshProgress.current}/${refreshProgress.total}` : "Refreshing"}
                    </span>
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5 md:h-4 md:w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span className="hidden text-sm font-normal md:inline">Refresh All</span>
                  </>
                )}
              </span>
            </button>
            {/* Upload */}
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="inline-flex items-center justify-center rounded-md border border-primary-200 bg-primary-50 p-2 text-gray-900 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-primary-700 dark:bg-primary-500/20 dark:text-gray-100 dark:hover:bg-primary-500/30"
              aria-label={isUploading ? "Uploading PDF" : "Upload PDF"}
              title="Upload PDF"
            >
              {isUploading ? (
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile search bar */}
        {showMobileSearch && (
          <div className="mt-4 md:hidden">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search papers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full rounded-md border border-gray-200 bg-gray-50/50 px-3 py-2 pr-8 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-800"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Clear search"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>


      <LiveRegion message={searchResultsMessage} />

      <DropZone onDrop={handleFileDrop} onReject={handleFileReject} className="min-h-[200px]">
      {papers === undefined ? (
        <PaperCardSkeletonGrid count={8} />
      ) : papers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
          <div className="mb-4 rounded-full bg-gray-100 p-4 dark:bg-gray-800">
            <svg
              className="h-8 w-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h3 className="mb-1 text-lg font-normal text-gray-900 dark:text-gray-100">
            No papers yet
          </h3>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Upload a PDF or connect a repository to start tracking your papers.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="inline-flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-normal text-gray-900 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-500/20 dark:text-gray-100 dark:hover:bg-primary-500/30 focus:ring-offset-2 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload PDF
            </button>
            <Link
              to="/repositories"
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Add Repository
            </Link>
          </div>
        </div>
      ) : filteredPapers.length === 0 ? (
        /* Empty search/filter state */
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
          <div className="mb-4 rounded-full bg-gray-100 p-4 dark:bg-gray-800">
            <svg
              className="h-8 w-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h3 className="mb-1 text-lg font-normal text-gray-900 dark:text-gray-100">
            No matching papers
          </h3>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            No papers found matching "{searchQuery}"
          </p>
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredPapers.map((paper) => (
            <PaperCard
              key={paper._id}
              paper={paper}
              isEditing={editingPaperId === paper._id}
              editTitle={editTitle}
              inputRef={inputRef}
              onEditTitleChange={setEditTitle}
              onSaveTitle={handleSaveTitle}
              onKeyDown={handleKeyDown}
              onStartEdit={handleStartEdit}
              onDeleteClick={handleDeleteClick}
              onFullscreen={handleFullscreen}
            />
          ))}
        </div>
      )}
      </DropZone>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingPaperId}
        title="Delete Paper"
        message="Are you sure you want to delete this paper? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingPaperId(null)}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={clearToast}
        />
      )}

      {/* Fullscreen PDF Overlay */}
      {fullscreenPdf && (
        <FullscreenPdfOverlay
          url={fullscreenPdf.url}
          title={fullscreenPdf.title}
          onClose={() => setFullscreenPdf(null)}
        />
      )}
    </div>
  );
}

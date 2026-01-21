import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "../hooks/useUser";
import { useDebounce } from "../hooks/useDebounce";
import type { Id } from "../../convex/_generated/dataModel";
import { Toast, ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../hooks/useToast";
import { PaperCardSkeletonGrid, LiveRegion, ProgressBar } from "../components/ui";
import { DropZone } from "../components/DropZone";

export const Route = createFileRoute("/")({
  component: GalleryPage,
});

// Format timestamp as relative time (e.g., "2 hours ago")
function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "Never";

  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

// Convert git URL to web URL for the repository
function getRepoWebUrl(gitUrl: string, provider: string): string | null {
  // Remove .git suffix if present
  const url = gitUrl.replace(/\.git$/, "");

  // GitHub: https://github.com/owner/repo
  if (provider === "github") {
    const match = url.match(/github\.com[/:]([\w-]+\/[\w.-]+)/);
    if (match) return `https://github.com/${match[1]}`;
  }

  // GitLab: https://gitlab.com/owner/repo
  if (provider === "gitlab") {
    const match = url.match(/gitlab\.com[/:]((?:[\w-]+\/)+[\w.-]+)/);
    if (match) return `https://gitlab.com/${match[1]}`;
  }

  // Overleaf: https://www.overleaf.com/project/<id>
  if (provider === "overleaf") {
    const match = url.match(/git\.overleaf\.com\/([a-f0-9]+)/i);
    if (match) return `https://www.overleaf.com/project/${match[1]}`;
  }

  // Self-hosted GitLab: convert git URL to web URL
  if (provider === "selfhosted-gitlab") {
    // Handle both https:// and git@ formats
    if (url.startsWith("git@")) {
      const match = url.match(/git@([^:]+):(.+)/);
      if (match) return `https://${match[1]}/${match[2]}`;
    }
    // Already https format
    return url;
  }

  return null;
}

function GalleryPage() {
  const { user, isLoading: isUserLoading, isAuthenticated } = useUser();
  const papers = useQuery(api.papers.list, isAuthenticated && user ? { userId: user._id } : "skip");
  const repositories = useQuery(api.repositories.list, isAuthenticated && user ? { userId: user._id } : "skip");
  const updatePaper = useMutation(api.papers.update);
  const deletePaper = useMutation(api.papers.deletePaper);
  const generateUploadUrl = useMutation(api.papers.generateUploadUrl);
  const uploadPdf = useMutation(api.papers.uploadPdf);
  const generateThumbnail = useAction(api.thumbnail.generateThumbnailForPaper);
  const refreshRepository = useAction(api.sync.refreshRepository);

  const [editingPaperId, setEditingPaperId] = useState<Id<"papers"> | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [deletingPaperId, setDeletingPaperId] = useState<Id<"papers"> | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Search, sort, and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [sortBy, setSortBy] = useState<"recent" | "least-recent" | "a-z" | "repository">("recent");

  // Toast state using hook
  const { toast, showError, showToast, clearToast } = useToast();

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
  // Uses requestIdleCallback to avoid blocking UI and sequential checking to reduce load
  useEffect(() => {
    if (
      repositories &&
      repositories.length > 0 &&
      !hasSyncedOnLoad.current &&
      !isSyncing
    ) {
      hasSyncedOnLoad.current = true;

      const reposToCheck = repositories.filter((repo) => repo.syncStatus !== "syncing");
      if (reposToCheck.length === 0) return;

      // Use requestIdleCallback to defer check until browser is idle
      const scheduleCheck = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 100));

      scheduleCheck(() => {
        setIsSyncing(true);
        setSyncProgress({ current: 0, total: reposToCheck.length });

        let hasErrors = false;
        let currentIndex = 0;

        // Check repos sequentially with idle callbacks between each
        const checkNext = async () => {
          if (currentIndex >= reposToCheck.length) {
            setIsSyncing(false);
            setSyncProgress(null);
            if (hasErrors) {
              showToast("Some repositories failed to check", "info");
            }
            return;
          }

          const repo = reposToCheck[currentIndex];
          try {
            await refreshRepository({ repositoryId: repo._id });
          } catch (err) {
            console.error(`Quick check failed for ${repo.name}:`, err);
            hasErrors = true;
          }

          currentIndex++;
          setSyncProgress({ current: currentIndex, total: reposToCheck.length });

          // Use idle callback for next check to keep UI responsive
          scheduleCheck(checkNext);
        };

        checkNext();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once on load
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
    result.sort((a, b) => {
      switch (sortBy) {
        case "recent":
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        case "least-recent":
          return (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
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
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
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
      if (!file || !user) return;

      if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
        showToast("Please drop a valid PDF file", "error");
        return;
      }

      setIsUploading(true);
      try {
        const uploadUrl = await generateUploadUrl();
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!response.ok) {
          throw new Error("Failed to upload file");
        }

        const { storageId } = await response.json();
        const title = file.name.replace(/\.pdf$/i, "");
        const paperId = await uploadPdf({
          userId: user._id,
          title,
          pdfStorageId: storageId,
          fileSize: file.size,
        });

        generateThumbnail({ paperId }).catch((error) => {
          console.error("Thumbnail generation failed:", error);
          showToast("Thumbnail generation failed - PDF uploaded successfully", "info");
        });
      } catch (error) {
        console.error("Upload failed:", error);
        showError(error, "Failed to upload PDF");
      } finally {
        setIsUploading(false);
      }
    },
    [user, generateUploadUrl, uploadPdf, generateThumbnail, showToast, showError]
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
    if (editingPaperId && editTitle.trim()) {
      try {
        await updatePaper({ id: editingPaperId, title: editTitle.trim() });
      } catch (error) {
        console.error("Failed to update title:", error);
        showError(error, "Failed to update paper title");
      }
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

    // Filter repos that aren't already syncing
    const reposToCheck = repositories.filter((repo) => repo.syncStatus !== "syncing");
    setSyncProgress({ current: 0, total: reposToCheck.length });

    // Quick check all repositories in parallel
    let failedCount = 0;
    let completedCount = 0;
    const checkPromises = reposToCheck.map(async (repo) => {
      try {
        await refreshRepository({ repositoryId: repo._id });
      } catch (err) {
        console.error(`Quick check failed for ${repo.name}:`, err);
        failedCount++;
      }
      completedCount++;
      setSyncProgress((prev) => prev ? { ...prev, current: completedCount } : null);
    });

    await Promise.all(checkPromises);

    setIsSyncing(false);
    setSyncProgress(null);

    if (failedCount > 0) {
      showToast(`${failedCount} ${failedCount === 1 ? "repository" : "repositories"} failed to check`, "error");
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
      showToast("Please select a valid PDF file", "error");
      return;
    }

    setIsUploading(true);
    try {
      // Get upload URL from Convex
      const uploadUrl = await generateUploadUrl();

      // Upload the file
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!response.ok) {
        throw new Error("Failed to upload file");
      }

      const { storageId } = await response.json();

      // Create the paper with the uploaded PDF
      const title = file.name.replace(/\.pdf$/i, "");
      const paperId = await uploadPdf({
        userId: user._id,
        title,
        pdfStorageId: storageId,
        fileSize: file.size,
      });

      // Generate thumbnail in the background (don't block on it, show warning only)
      generateThumbnail({ paperId }).catch((error) => {
        console.error("Thumbnail generation failed:", error);
        showToast("Thumbnail generation failed - PDF uploaded successfully", "info");
      });
    } catch (error) {
      console.error("Upload failed:", error);
      showError(error, "Failed to upload PDF");
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
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

      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-2xl font-normal text-gray-900 dark:text-gray-100">Your Papers</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search papers... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-56 rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-2 pr-8 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-800"
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
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="recent">Recent</option>
            <option value="least-recent">Least recent</option>
            <option value="a-z">A-Z</option>
            <option value="repository">By repository</option>
          </select>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckAll}
              disabled={isSyncing || !repositories || repositories.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Check all repositories for new commits"
              aria-label={isSyncing ? "Checking repositories" : "Check all repositories"}
            >
              {isSyncing ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Checking
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Check All
                </>
              )}
            </button>
            {isSyncing && syncProgress && (
              <ProgressBar
                current={syncProgress.current}
                total={syncProgress.total}
                showCount={false}
                className="w-24"
              />
            )}
          </div>
          <button
            onClick={handleUploadClick}
            disabled={isUploading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-normal text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            aria-label={isUploading ? "Uploading PDF" : "Upload PDF"}
          >
            {isUploading ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload PDF
              </>
            )}
          </button>
        </div>
      </div>


      <LiveRegion message={searchResultsMessage} />

      <DropZone onDrop={handleFileDrop} className="min-h-[200px]">
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
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-normal text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
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
          {filteredPapers.map((paper) => {
            const isEditing = editingPaperId === paper._id;
            const cardClassName = "group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition-all duration-200 hover:border-gray-200 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700";

            const cardContent = (
              <>
              {/* Thumbnail */}
              <div className="relative aspect-[8.5/11] w-full bg-gray-100 dark:bg-gray-800">
                {paper.thumbnailUrl ? (
                  <img
                    src={paper.thumbnailUrl}
                    alt={paper.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400">
                    <svg
                      className="h-12 w-12"
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
                  </div>
                )}
                {/* Fullscreen button overlay */}
                {paper.pdfUrl && (
                  <a
                    href={paper.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                    title="View PDF fullscreen"
                    aria-label={`View ${paper.title} PDF fullscreen`}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  </a>
                )}
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start gap-1">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={handleSaveTitle}
                      onKeyDown={handleKeyDown}
                      className="flex-1 truncate rounded border border-blue-400 px-1 py-0.5 text-sm font-normal text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
                    />
                  ) : (
                    <>
                      <h3 className="font-serif flex-1 truncate font-normal text-gray-900 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
                        {paper.title}
                      </h3>
                      <button
                        onClick={(e) => handleStartEdit(e, paper._id, paper.title)}
                        className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                        title="Rename"
                        aria-label={`Rename ${paper.title}`}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(e, paper._id)}
                        className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30"
                        title="Delete"
                        aria-label={`Delete ${paper.title}`}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
                {paper.authors && paper.authors.length > 0 && (
                  <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                    {paper.authors.join(", ")}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                  {paper.repository ? (
                    <span className="flex items-center gap-1 truncate">
                      {(() => {
                        const webUrl = getRepoWebUrl(paper.repository.gitUrl, paper.repository.provider);
                        return webUrl ? (
                          <a
                            href={webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="truncate hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                            title={`Open ${paper.repository.name} on ${paper.repository.provider}`}
                          >
                            {paper.repository.name}
                          </a>
                        ) : (
                          <span className="truncate">{paper.repository.name}</span>
                        );
                      })()}
                      {paper.buildStatus === "building" ? (
                        <span
                          className="flex shrink-0 items-center gap-0.5 text-blue-600"
                          title={paper.compilationProgress || (paper.pdfSourceType === "compile" ? "Compiling LaTeX..." : "Fetching PDF...")}
                        >
                          <svg
                            className="h-3 w-3 animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span className="text-[10px]">
                            {paper.pdfSourceType === "compile" ? "Compiling" : "Fetching"}
                          </span>
                        </span>
                      ) : paper.repository.syncStatus === "syncing" ? (
                        <span
                          className="flex shrink-0 items-center gap-0.5 text-gray-500"
                          title="Checking for updates..."
                        >
                          <svg
                            className="h-3 w-3 animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span className="text-[10px]">Checking</span>
                        </span>
                      ) : null}
                      {paper.buildStatus !== "building" && paper.repository.syncStatus !== "syncing" && paper.isUpToDate === true && (
                        <span
                          className="flex shrink-0 items-center gap-0.5 text-green-600"
                          title={`Up to date - committed ${formatRelativeTime(paper.repository.lastCommitTime ?? paper.repository.lastSyncedAt)}`}
                        >
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          <span className="text-[10px]">
                            {formatRelativeTime(paper.repository.lastCommitTime ?? paper.repository.lastSyncedAt)}
                          </span>
                        </span>
                      )}
                      {paper.buildStatus !== "building" && paper.repository.syncStatus !== "syncing" && paper.isUpToDate === false && !paper.lastSyncError && (
                        <span
                          className="flex shrink-0 items-center gap-0.5 text-yellow-600"
                          title={`New commit available - committed ${formatRelativeTime(paper.repository.lastCommitTime ?? paper.repository.lastSyncedAt)}`}
                        >
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span className="text-[10px]">
                            {formatRelativeTime(paper.repository.lastCommitTime ?? paper.repository.lastSyncedAt)}
                          </span>
                        </span>
                      )}
                      {paper.buildStatus !== "building" && paper.repository.syncStatus !== "syncing" && paper.lastSyncError && (
                        <span
                          className="flex shrink-0 items-center gap-0.5 text-red-600"
                          title={`${paper.pdfSourceType === "compile" ? "Compilation" : "Sync"} failed: ${paper.lastSyncError}`}
                        >
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                            />
                          </svg>
                          <span className="text-[10px]">
                            {paper.pdfSourceType === "compile" ? "Compilation failed" : "Sync failed"}
                          </span>
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-purple-600">Uploaded</span>
                  )}
                  <span className="flex items-center">
                    {paper.isPublic ? (
                      <span className="flex items-center text-green-600">
                        <svg
                          className="mr-1 h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                        Public
                      </span>
                    ) : (
                      <span className="flex items-center">
                        <svg
                          className="mr-1 h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                          />
                        </svg>
                        Private
                      </span>
                    )}
                  </span>
                </div>
              </div>
              </>
            );

            return isEditing ? (
              <div key={paper._id} className={cardClassName}>
                {cardContent}
              </div>
            ) : (
              <Link
                key={paper._id}
                to="/papers/$id"
                params={{ id: paper._id }}
                className={cardClassName}
              >
                {cardContent}
              </Link>
            );
          })}
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
    </div>
  );
}

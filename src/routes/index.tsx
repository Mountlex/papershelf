import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "../hooks/useUser";
import type { Id } from "../../convex/_generated/dataModel";
import { Toast } from "../components/ConfirmDialog";

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

function GalleryPage() {
  const { user, isLoading: isUserLoading, isAuthenticated } = useUser();
  const papers = useQuery(api.papers.list, isAuthenticated && user ? { userId: user._id } : "skip");
  const repositories = useQuery(api.repositories.list, isAuthenticated && user ? { userId: user._id } : "skip");
  const updatePaper = useMutation(api.papers.update);
  const deletePaper = useMutation(api.papers.deletePaper);
  const generateUploadUrl = useMutation(api.papers.generateUploadUrl);
  const uploadPdf = useMutation(api.papers.uploadPdf);
  const generateThumbnail = useAction(api.thumbnail.generateThumbnailForPaper);
  const syncRepository = useAction(api.sync.syncRepository);

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
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "a-z" | "repository">("newest");
  const [statusFilter, setStatusFilter] = useState<"all" | "synced" | "needs-sync" | "uploaded">("all");

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "error" | "success" | "info" } | null>(null);

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

  // Quick sync all repositories on page load (just check for new commits, no compilation)
  useEffect(() => {
    if (
      repositories &&
      repositories.length > 0 &&
      !hasSyncedOnLoad.current &&
      !isSyncing
    ) {
      hasSyncedOnLoad.current = true;
      // Quick sync all repositories in parallel (non-blocking)
      setIsSyncing(true);
      const syncPromises = repositories
        .filter((repo) => repo.syncStatus !== "syncing")
        .map((repo) =>
          syncRepository({ repositoryId: repo._id }).catch((err) => {
            console.error(`Quick sync failed for ${repo.name}:`, err);
          })
        );
      Promise.all(syncPromises).finally(() => {
        setIsSyncing(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once on load
  }, [repositories]);

  // Filter and sort papers
  const filteredPapers = useMemo(() => {
    if (!papers) return [];

    let result = [...papers];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((paper) => {
        const titleMatch = paper.title.toLowerCase().includes(query);
        const authorsMatch = paper.authors?.some((author: string) =>
          author.toLowerCase().includes(query)
        );
        return titleMatch || authorsMatch;
      });
    }

    // Apply status filter
    if (statusFilter !== "all") {
      result = result.filter((paper) => {
        switch (statusFilter) {
          case "synced":
            return paper.isUpToDate === true;
          case "needs-sync":
            return paper.isUpToDate === false;
          case "uploaded":
            return paper.isUpToDate === null || paper.isUpToDate === undefined;
          default:
            return true;
        }
      });
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return (b._creationTime ?? 0) - (a._creationTime ?? 0);
        case "oldest":
          return (a._creationTime ?? 0) - (b._creationTime ?? 0);
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
          return (b._creationTime ?? 0) - (a._creationTime ?? 0);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [papers, searchQuery, statusFilter, sortBy]);

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
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
      }
    }
    setEditingPaperId(null);
    setEditTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveTitle();
    } else if (e.key === "Escape") {
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
      }
      setDeletingPaperId(null);
    }
  };

  // Quick sync all repositories (just check for new commits, no compilation)
  const handleSyncAll = async () => {
    if (!repositories || isSyncing) return;

    setIsSyncing(true);
    setSyncProgress({ current: 0, total: repositories.length });

    // Quick sync all repositories in parallel
    const syncPromises = repositories
      .filter((repo) => repo.syncStatus !== "syncing")
      .map(async (repo, index) => {
        try {
          await syncRepository({ repositoryId: repo._id });
        } catch (err) {
          console.error(`Quick sync failed for ${repo.name}:`, err);
        }
        setSyncProgress((prev) => prev ? { ...prev, current: index + 1 } : null);
      });

    await Promise.all(syncPromises);

    setIsSyncing(false);
    setSyncProgress(null);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.name.endsWith(".pdf")) {
      setToast({ message: "Please select a PDF file", type: "error" });
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

      // Generate thumbnail in the background (don't block on it)
      generateThumbnail({ paperId }).catch((error) => {
        console.error("Thumbnail generation failed:", error);
      });
    } catch (error) {
      console.error("Upload failed:", error);
      setToast({ message: "Failed to upload PDF", type: "error" });
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
        <div className="text-gray-500">Loading...</div>
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
        <h1 className="text-2xl font-bold text-gray-900">Your Papers</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search papers... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 rounded-md border border-gray-300 px-4 py-2 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="a-z">A-Z</option>
            <option value="repository">By repository</option>
          </select>
          <button
            onClick={handleSyncAll}
            disabled={isSyncing || !repositories || repositories.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            title="Check all repositories for new commits"
          >
            {isSyncing ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {syncProgress ? `${syncProgress.current}/${syncProgress.total}` : "Checking..."}
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Check All
              </>
            )}
          </button>
          <button
            onClick={handleUploadClick}
            disabled={isUploading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload PDF
              </>
            )}
          </button>
        </div>
      </div>

      {/* Filter chips and results count */}
      {papers && papers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500">Filter:</span>
            <button
              onClick={() => setStatusFilter("all")}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                statusFilter === "all"
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter("synced")}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                statusFilter === "synced"
                  ? "bg-green-600 text-white"
                  : "bg-green-50 text-green-700 hover:bg-green-100"
              }`}
            >
              Up to date
            </button>
            <button
              onClick={() => setStatusFilter("needs-sync")}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                statusFilter === "needs-sync"
                  ? "bg-yellow-500 text-white"
                  : "bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
              }`}
            >
              Needs sync
            </button>
            <button
              onClick={() => setStatusFilter("uploaded")}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                statusFilter === "uploaded"
                  ? "bg-purple-600 text-white"
                  : "bg-purple-50 text-purple-700 hover:bg-purple-100"
              }`}
            >
              Uploaded
            </button>
          </div>
          <div className="text-sm text-gray-500">
            Showing {filteredPapers.length} of {papers.length} papers
          </div>
        </div>
      )}

      {papers === undefined ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading papers...</div>
        </div>
      ) : papers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <div className="mb-4 rounded-full bg-gray-100 p-4">
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
          <h3 className="mb-1 text-lg font-medium text-gray-900">
            No papers yet
          </h3>
          <p className="mb-4 text-sm text-gray-500">
            Upload a PDF or connect a repository to start tracking your papers.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload PDF
            </button>
            <Link
              to="/repositories"
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Add Repository
            </Link>
          </div>
        </div>
      ) : filteredPapers.length === 0 ? (
        /* Empty search/filter state */
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <div className="mb-4 rounded-full bg-gray-100 p-4">
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
          <h3 className="mb-1 text-lg font-medium text-gray-900">
            No matching papers
          </h3>
          <p className="mb-4 text-sm text-gray-500">
            {searchQuery
              ? `No papers found matching "${searchQuery}"`
              : "No papers match the selected filter"}
          </p>
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredPapers.map((paper) => (
            <Link
              key={paper._id}
              to="/papers/$id"
              params={{ id: paper._id }}
              className="group overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Thumbnail */}
              <div className="aspect-[8.5/11] w-full bg-gray-100">
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
              </div>

              {/* Info */}
              <div className="p-3">
                <div className="flex items-start gap-1">
                  {editingPaperId === paper._id ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={handleSaveTitle}
                      onKeyDown={handleKeyDown}
                      onClick={(e) => e.preventDefault()}
                      className="flex-1 truncate rounded border border-blue-400 px-1 py-0.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  ) : (
                    <>
                      <h3 className="flex-1 truncate font-medium text-gray-900 group-hover:text-blue-600">
                        {paper.title}
                      </h3>
                      <button
                        onClick={(e) => handleStartEdit(e, paper._id, paper.title)}
                        className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
                        title="Rename"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(e, paper._id)}
                        className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100"
                        title="Delete"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
                {paper.authors && paper.authors.length > 0 && (
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {paper.authors.join(", ")}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                  {paper.repository ? (
                    <span className="flex items-center gap-1 truncate">
                      <span className="truncate">{paper.repository.name}</span>
                      {paper.isUpToDate === true && (
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
                      {paper.isUpToDate === false && !paper.lastSyncError && (
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
                      {paper.lastSyncError && (
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
            </Link>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingPaperId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-medium text-gray-900">Delete Paper</h3>
            <p className="mt-2 text-sm text-gray-500">
              Are you sure you want to delete this paper? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setDeletingPaperId(null)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

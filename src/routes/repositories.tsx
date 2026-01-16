import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUser } from "../hooks/useUser";

export const Route = createFileRoute("/repositories")({
  component: RepositoriesPage,
});

function RepositoriesPage() {
  const { user, isLoading: isUserLoading, isAuthenticated } = useUser();
  const repositories = useQuery(
    api.repositories.list,
    isAuthenticated && user ? { userId: user._id } : "skip"
  );
  const addRepository = useMutation(api.repositories.add);
  const removeRepository = useMutation(api.repositories.remove);
  const syncRepository = useAction(api.sync.syncRepository);
  const fetchRepoInfo = useAction(api.sync.fetchRepoInfo);
  const listUserRepos = useAction(api.sync.listUserRepos);
  const listRepositoryFiles = useAction(api.sync.listRepositoryFiles);
  const addTrackedFile = useMutation(api.papers.addTrackedFile);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Configure modal state
  const [configureRepo, setConfigureRepo] = useState<{
    _id: Id<"repositories">;
    name: string;
    gitUrl: string;
    defaultBranch: string;
  } | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [repoFiles, setRepoFiles] = useState<Array<{
    name: string;
    path: string;
    type: "file" | "dir";
  }> | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Array<{
    path: string;
    title: string;
    pdfSourceType: "compile" | "committed";
  }>>([]);
  const [isAddingFiles, setIsAddingFiles] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const [userRepos, setUserRepos] = useState<Array<{
    name: string;
    fullName: string;
    url: string;
    description: string | null;
    isPrivate: boolean;
    defaultBranch: string;
    updatedAt: string;
    ownerAvatar: string;
  }> | null>(null);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");

  // Load user repos when modal opens
  useEffect(() => {
    if (isAddModalOpen && userRepos === null && !isLoadingRepos) {
      setIsLoadingRepos(true);
      listUserRepos()
        .then(setUserRepos)
        .catch((err) => {
          console.error("Failed to load repos:", err);
          setAddError("Failed to load repositories");
        })
        .finally(() => setIsLoadingRepos(false));
    }
  }, [isAddModalOpen, userRepos, isLoadingRepos, listUserRepos]);

  const filteredRepos = userRepos?.filter(
    (repo) =>
      repo.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      repo.fullName.toLowerCase().includes(repoSearch.toLowerCase()) ||
      repo.description?.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const handleAddRepository = async () => {
    if (!user || !gitUrl.trim()) return;

    setIsAdding(true);
    setAddError(null);
    try {
      // First, fetch repo info to get the correct default branch
      const repoInfo = await fetchRepoInfo({ gitUrl: gitUrl.trim() });

      // Add with the correct default branch (private repos supported with OAuth)
      await addRepository({
        userId: user._id,
        gitUrl: gitUrl.trim(),
        name: repoInfo.name,
        defaultBranch: repoInfo.defaultBranch,
      });
      setIsAddModalOpen(false);
      setGitUrl("");
      setRepoSearch("");
    } catch (error) {
      console.error("Failed to add repository:", error);
      const message = error instanceof Error ? error.message : "Failed to add repository";
      setAddError(message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddFromList = async (repo: {
    url: string;
    name: string;
    defaultBranch: string;
  }) => {
    if (!user) return;

    setIsAdding(true);
    setAddError(null);
    try {
      await addRepository({
        userId: user._id,
        gitUrl: repo.url,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
      });
      setIsAddModalOpen(false);
      setRepoSearch("");
    } catch (error) {
      console.error("Failed to add repository:", error);
      const message = error instanceof Error ? error.message : "Failed to add repository";
      setAddError(message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleSync = async (repoId: Id<"repositories">) => {
    setSyncingRepoId(repoId);
    try {
      await syncRepository({ repositoryId: repoId });
    } catch (error) {
      console.error("Failed to sync repository:", error);
      alert("Failed to sync repository.");
    } finally {
      setSyncingRepoId(null);
    }
  };

  const handleDelete = async (repoId: Id<"repositories">) => {
    if (!confirm("Are you sure you want to delete this repository?")) return;
    try {
      await removeRepository({ id: repoId });
    } catch (error) {
      console.error("Failed to delete repository:", error);
    }
  };

  // Configure modal handlers
  const openConfigureModal = async (repo: {
    _id: Id<"repositories">;
    name: string;
    gitUrl: string;
    defaultBranch: string;
  }) => {
    setConfigureRepo(repo);
    setCurrentPath("");
    setSelectedFiles([]);
    setRepoFiles(null);
    loadFiles(repo.gitUrl, repo.defaultBranch, "");
  };

  const loadFiles = async (gitUrl: string, branch: string, path: string) => {
    setIsLoadingFiles(true);
    try {
      const files = await listRepositoryFiles({ gitUrl, path, branch });
      setRepoFiles(files);
      setCurrentPath(path);
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const navigateToFolder = (path: string) => {
    if (configureRepo) {
      loadFiles(configureRepo.gitUrl, configureRepo.defaultBranch, path);
    }
  };

  const navigateUp = () => {
    const parentPath = currentPath.split("/").slice(0, -1).join("/");
    if (configureRepo) {
      loadFiles(configureRepo.gitUrl, configureRepo.defaultBranch, parentPath);
    }
  };

  const toggleFileSelection = (file: { path: string; name: string }) => {
    const isSelected = selectedFiles.some((f) => f.path === file.path);
    if (isSelected) {
      setSelectedFiles(selectedFiles.filter((f) => f.path !== file.path));
    } else {
      // Default title is filename without extension
      const title = file.name.replace(/\.(tex|pdf)$/, "");
      const pdfSourceType = file.name.endsWith(".pdf") ? "committed" : "compile";
      setSelectedFiles([...selectedFiles, { path: file.path, title, pdfSourceType }]);
    }
  };

  const updateFileTitle = (path: string, title: string) => {
    setSelectedFiles(
      selectedFiles.map((f) => (f.path === path ? { ...f, title } : f))
    );
  };

  const handleAddTrackedFiles = async () => {
    if (!configureRepo || selectedFiles.length === 0) return;

    setIsAddingFiles(true);
    try {
      for (const file of selectedFiles) {
        await addTrackedFile({
          repositoryId: configureRepo._id,
          filePath: file.path,
          title: file.title,
          pdfSourceType: file.pdfSourceType,
        });
      }
      setConfigureRepo(null);
      setSelectedFiles([]);
    } catch (error) {
      console.error("Failed to add tracked files:", error);
      alert("Failed to add files. Please try again.");
    } finally {
      setIsAddingFiles(false);
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
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Repositories</h1>
        <button
          onClick={() => {
            setIsAddModalOpen(true);
            setAddError(null);
            setGitUrl("");
          }}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Add Repository
        </button>
      </div>

      {/* Repository List */}
      {repositories === undefined ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading repositories...</div>
        </div>
      ) : repositories.length === 0 ? (
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
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          </div>
          <h3 className="mb-1 text-lg font-medium text-gray-900">
            No repositories connected
          </h3>
          <p className="mb-4 text-sm text-gray-500">
            Add a GitHub repository to start tracking your LaTeX papers.
          </p>
          <button
            onClick={() => {
              setIsAddModalOpen(true);
              setAddError(null);
              setGitUrl("");
            }}
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Add Repository
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {repositories.map((repo) => (
            <div
              key={repo._id}
              className="rounded-lg border bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <div className="rounded-full bg-gray-100 p-2">
                    <svg
                      className="h-5 w-5 text-gray-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">{repo.name}</h3>
                    <p className="text-sm text-gray-500">{repo.gitUrl}</p>
                    <div className="mt-2 flex items-center space-x-4 text-xs text-gray-400">
                      <span className="capitalize">{repo.provider}</span>
                      <span>Branch: {repo.defaultBranch}</span>
                      {repo.lastSyncedAt && (
                        <span>
                          Last synced:{" "}
                          {new Date(repo.lastSyncedAt).toLocaleString()}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          repo.syncStatus === "idle"
                            ? "bg-green-100 text-green-800"
                            : repo.syncStatus === "syncing"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {repo.syncStatus}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => openConfigureModal(repo)}
                    className="inline-flex items-center rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
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
                        d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                      />
                    </svg>
                    Configure
                  </button>
                  <button
                    onClick={() => handleSync(repo._id)}
                    disabled={syncingRepoId === repo._id}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                  >
                    {syncingRepoId === repo._id ? (
                      <>
                        <svg
                          className="mr-1 h-3 w-3 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Syncing
                      </>
                    ) : (
                      <>
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
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        Sync
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(repo._id)}
                    className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Repository Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Add Repository
              </h2>
              <button
                onClick={() => {
                  setIsAddModalOpen(false);
                  setAddError(null);
                  setRepoSearch("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="border-b p-4">
              <input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Search your repositories..."
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {isLoadingRepos ? (
                <div className="flex items-center justify-center py-8">
                  <svg
                    className="h-6 w-6 animate-spin text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span className="ml-2 text-sm text-gray-500">Loading repositories...</span>
                </div>
              ) : filteredRepos && filteredRepos.length > 0 ? (
                <div className="space-y-1">
                  {filteredRepos.map((repo) => (
                    <button
                      key={repo.fullName}
                      onClick={() => handleAddFromList(repo)}
                      disabled={isAdding}
                      className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-gray-100 disabled:opacity-50"
                    >
                      <img
                        src={repo.ownerAvatar}
                        alt=""
                        className="h-8 w-8 rounded-full"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-gray-900">
                            {repo.fullName}
                          </span>
                          {repo.isPrivate && (
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                              Private
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="truncate text-xs text-gray-500">
                            {repo.description}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : userRepos && filteredRepos?.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500">
                  No repositories found matching "{repoSearch}"
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-gray-500">
                  No repositories available
                </div>
              )}
            </div>

            <div className="border-t p-4">
              <p className="mb-2 text-xs text-gray-500">Or enter a URL manually:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={gitUrl}
                  onChange={(e) => {
                    setGitUrl(e.target.value);
                    setAddError(null);
                  }}
                  placeholder="https://github.com/username/repo"
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isAdding && gitUrl.trim()) {
                      handleAddRepository();
                    }
                  }}
                />
                <button
                  onClick={handleAddRepository}
                  disabled={isAdding || !gitUrl.trim()}
                  className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isAdding ? "Adding..." : "Add"}
                </button>
              </div>
              {addError && (
                <p className="mt-2 text-sm text-red-600">{addError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Configure Repository Modal */}
      {configureRepo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Configure Papers
                </h2>
                <p className="text-sm text-gray-500">{configureRepo.name}</p>
              </div>
              <button
                onClick={() => setConfigureRepo(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* File Browser */}
              <div className="flex w-1/2 flex-col border-r">
                <div className="border-b bg-gray-50 px-4 py-2">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <button
                      onClick={() => navigateToFolder("")}
                      className="hover:text-blue-600"
                    >
                      {configureRepo.name}
                    </button>
                    {currentPath && (
                      <>
                        {currentPath.split("/").map((part, i, arr) => (
                          <span key={i} className="flex items-center gap-2">
                            <span>/</span>
                            <button
                              onClick={() => navigateToFolder(arr.slice(0, i + 1).join("/"))}
                              className="hover:text-blue-600"
                            >
                              {part}
                            </button>
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {isLoadingFiles ? (
                    <div className="flex items-center justify-center py-8">
                      <svg className="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {currentPath && (
                        <button
                          onClick={navigateUp}
                          className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-gray-100"
                        >
                          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                          </svg>
                          <span className="text-gray-500">..</span>
                        </button>
                      )}
                      {repoFiles?.map((file) => {
                        const isTexOrPdf = file.name.endsWith(".tex") || file.name.endsWith(".pdf");
                        const isSelected = selectedFiles.some((f) => f.path === file.path);

                        if (file.type === "dir") {
                          return (
                            <button
                              key={file.path}
                              onClick={() => navigateToFolder(file.path)}
                              className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-gray-100"
                            >
                              <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              {file.name}
                            </button>
                          );
                        }

                        return (
                          <button
                            key={file.path}
                            onClick={() => isTexOrPdf && toggleFileSelection(file)}
                            disabled={!isTexOrPdf}
                            className={`flex w-full items-center gap-2 rounded p-2 text-left text-sm ${
                              isTexOrPdf
                                ? isSelected
                                  ? "bg-blue-100 text-blue-900"
                                  : "hover:bg-gray-100"
                                : "cursor-not-allowed text-gray-400"
                            }`}
                          >
                            {isTexOrPdf && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600"
                              />
                            )}
                            <svg className={`h-4 w-4 ${isTexOrPdf ? "text-gray-500" : "text-gray-300"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className={isTexOrPdf ? "" : ""}>{file.name}</span>
                            {file.name.endsWith(".tex") && (
                              <span className="ml-auto rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                                LaTeX
                              </span>
                            )}
                            {file.name.endsWith(".pdf") && (
                              <span className="ml-auto rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                                PDF
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Files */}
              <div className="flex w-1/2 flex-col">
                <div className="border-b bg-gray-50 px-4 py-2">
                  <h3 className="text-sm font-medium text-gray-700">
                    Selected Files ({selectedFiles.length})
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {selectedFiles.length === 0 ? (
                    <p className="text-center text-sm text-gray-500">
                      Select .tex or .pdf files from the file browser to track them as papers.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {selectedFiles.map((file) => (
                        <div key={file.path} className="rounded-lg border p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs text-gray-500">{file.path}</span>
                            <button
                              onClick={() => toggleFileSelection({ path: file.path, name: file.path.split("/").pop() || "" })}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          <input
                            type="text"
                            value={file.title}
                            onChange={(e) => updateFileTitle(file.path, e.target.value)}
                            placeholder="Paper title"
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <div className="mt-2 text-xs text-gray-500">
                            {file.pdfSourceType === "compile" ? (
                              <span className="text-green-600">Will be compiled from LaTeX</span>
                            ) : (
                              <span className="text-blue-600">PDF from repository</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t p-4">
              <button
                onClick={() => setConfigureRepo(null)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTrackedFiles}
                disabled={selectedFiles.length === 0 || isAddingFiles}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isAddingFiles ? "Adding..." : `Add ${selectedFiles.length} Paper${selectedFiles.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

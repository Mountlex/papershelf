import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUser } from "../hooks/useUser";
import { ConfirmDialog, Toast } from "../components/ConfirmDialog";

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
  const updateRepository = useMutation(api.repositories.update);
  const syncRepository = useAction(api.sync.syncRepository);
  const syncPaper = useAction(api.sync.syncPaper);
  const fetchRepoInfo = useAction(api.git.fetchRepoInfo);
  const listUserRepos = useAction(api.git.listUserRepos);
  const listUserGitLabRepos = useAction(api.git.listUserGitLabRepos);
  const listRepositoryFiles = useAction(api.git.listRepositoryFiles);
  const addTrackedFile = useMutation(api.papers.addTrackedFile);

  // Overleaf credential management
  const hasOverleafCreds = useQuery(api.users.hasOverleafCredentials);
  const saveOverleafCredentials = useMutation(api.users.saveOverleafCredentials);
  const clearOverleafCredentials = useMutation(api.users.clearOverleafCredentials);

  // Self-hosted GitLab instance management (multiple instances)
  const selfHostedGitLabInstances = useQuery(api.users.getSelfHostedGitLabInstances);
  const addSelfHostedGitLabInstance = useMutation(api.users.addSelfHostedGitLabInstance);
  const deleteSelfHostedGitLabInstance = useMutation(api.users.deleteSelfHostedGitLabInstance);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeAddTab, setActiveAddTab] = useState<"github" | "gitlab" | "overleaf" | "selfhosted" | "manual">("github");

  // Overleaf setup state
  const [showOverleafSetup, setShowOverleafSetup] = useState(false);
  const [overleafEmail, setOverleafEmail] = useState("");
  const [overleafToken, setOverleafToken] = useState("");
  const [isSavingOverleaf, setIsSavingOverleaf] = useState(false);
  const [overleafError, setOverleafError] = useState<string | null>(null);
  const [overleafGitUrl, setOverleafGitUrl] = useState("");
  const [isAddingOverleaf, setIsAddingOverleaf] = useState(false);

  // Self-hosted GitLab setup state (for adding new instances)
  const [showSelfHostedGitLabSetup, setShowSelfHostedGitLabSetup] = useState(false);
  const [selfHostedGitLabName, setSelfHostedGitLabName] = useState("");
  const [selfHostedGitLabUrlInput, setSelfHostedGitLabUrlInput] = useState("");
  const [selfHostedGitLabToken, setSelfHostedGitLabToken] = useState("");
  const [isSavingSelfHostedGitLab, setIsSavingSelfHostedGitLab] = useState(false);
  const [selfHostedGitLabError, setSelfHostedGitLabError] = useState<string | null>(null);
  const [selfHostedGitLabRepoUrl, setSelfHostedGitLabRepoUrl] = useState("");
  const [isAddingSelfHostedGitLab, setIsAddingSelfHostedGitLab] = useState(false);
  const [selectedSelfHostedInstance, setSelectedSelfHostedInstance] = useState<string | null>(null);

  // Inline edit state for repository name
  const [editingRepoId, setEditingRepoId] = useState<Id<"repositories"> | null>(null);
  const [editingRepoName, setEditingRepoName] = useState("");

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
  const [gitlabRepos, setGitlabRepos] = useState<Array<{
    name: string;
    fullName: string;
    url: string;
    description: string | null;
    isPrivate: boolean;
    defaultBranch: string;
    updatedAt: string;
    ownerAvatar: string;
  }> | null>(null);
  const [isLoadingGitLabRepos, setIsLoadingGitLabRepos] = useState(false);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: "danger" | "warning" | "default";
    onConfirm: () => void | Promise<void>;
  }>({ isOpen: false, title: "", message: "", variant: "default", onConfirm: () => {} });

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "error" | "success" | "info" } | null>(null);

  // Track if we've done initial quick sync
  const hasQuickSyncedRef = useRef(false);

  const hasGitHubToken = Boolean(user?.hasGitHubToken);
  const hasGitLabToken = Boolean(user?.hasGitLabToken);

  // Quick sync all repositories on page load to check for updates
  useEffect(() => {
    if (repositories && repositories.length > 0 && !hasQuickSyncedRef.current) {
      hasQuickSyncedRef.current = true;
      // Run quick sync on all repos in parallel (non-blocking)
      repositories.forEach((repo) => {
        if (repo.syncStatus !== "syncing") {
          syncRepository({ repositoryId: repo._id }).catch((err) => {
            console.error(`Quick sync failed for ${repo.name}:`, err);
          });
        }
      });
    }
  }, [repositories, syncRepository]);

  // Load user repos when GitHub tab is active
  useEffect(() => {
    if (isAddModalOpen && activeAddTab === "github" && hasGitHubToken && userRepos === null && !isLoadingRepos) {
      setIsLoadingRepos(true);
      listUserRepos()
        .then(setUserRepos)
        .catch((err) => {
          console.error("Failed to load repos:", err);
          setAddError("Failed to load repositories");
        })
        .finally(() => setIsLoadingRepos(false));
    }
  }, [isAddModalOpen, activeAddTab, hasGitHubToken, userRepos, isLoadingRepos, listUserRepos]);

  useEffect(() => {
    if (isAddModalOpen && activeAddTab === "gitlab" && hasGitLabToken && gitlabRepos === null && !isLoadingGitLabRepos) {
      setIsLoadingGitLabRepos(true);
      listUserGitLabRepos()
        .then(setGitlabRepos)
        .catch((err) => {
          console.error("Failed to load GitLab repos:", err);
          const message = err instanceof Error ? err.message : "Failed to load GitLab repositories";
          const isUnauthorized = message.includes("401") || message.toLowerCase().includes("unauthorized");
          setAddError(isUnauthorized ? "GitLab auth expired. Reconnect GitLab and try again." : "Failed to load GitLab repositories");
          setGitlabRepos([]);
        })
        .finally(() => setIsLoadingGitLabRepos(false));
    }
  }, [isAddModalOpen, activeAddTab, hasGitLabToken, gitlabRepos, isLoadingGitLabRepos, listUserGitLabRepos]);

  const filteredRepos = userRepos?.filter((repo) => {
    const query = repoSearch.toLowerCase();
    const description = (repo.description ?? "").toLowerCase();
    return (
      repo.name.toLowerCase().includes(query) ||
      repo.fullName.toLowerCase().includes(query) ||
      description.includes(query)
    );
  });

  const filteredGitLabRepos = gitlabRepos?.filter((repo) => {
    const query = repoSearch.toLowerCase();
    const description = (repo.description ?? "").toLowerCase();
    return (
      repo.name.toLowerCase().includes(query) ||
      repo.fullName.toLowerCase().includes(query) ||
      description.includes(query)
    );
  });

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

  const handleAddOverleafRepository = async () => {
    if (!user || !overleafGitUrl.trim()) return;

    setIsAddingOverleaf(true);
    setAddError(null);
    try {
      // Fetch repo info to verify access and get default branch
      const repoInfo = await fetchRepoInfo({ gitUrl: overleafGitUrl.trim() });

      await addRepository({
        userId: user._id,
        gitUrl: overleafGitUrl.trim(),
        name: repoInfo.name,
        defaultBranch: repoInfo.defaultBranch,
      });
      setIsAddModalOpen(false);
      setOverleafGitUrl("");
      setRepoSearch("");
    } catch (error) {
      console.error("Failed to add Overleaf repository:", error);
      const message = error instanceof Error ? error.message : "Failed to add Overleaf repository";
      setAddError(message);
    } finally {
      setIsAddingOverleaf(false);
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

  const handleAddFromGitLabList = async (repo: {
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
      console.error("Failed to add GitLab repository:", error);
      const message = error instanceof Error ? error.message : "Failed to add GitLab repository";
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
      setToast({ message: "Failed to sync repository.", type: "error" });
    } finally {
      setSyncingRepoId(null);
    }
  };

  const handleDelete = (repoId: Id<"repositories">) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Repository",
      message: "Are you sure you want to delete this repository? This will also remove all tracked papers from this repository.",
      variant: "danger",
      onConfirm: async () => {
        try {
          await removeRepository({ id: repoId });
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        } catch (error) {
          console.error("Failed to delete repository:", error);
          setToast({ message: "Failed to delete repository.", type: "error" });
        }
      },
    });
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
      const paperIds: string[] = [];
      for (const file of selectedFiles) {
        const result = await addTrackedFile({
          repositoryId: configureRepo._id,
          filePath: file.path,
          title: file.title,
          pdfSourceType: file.pdfSourceType,
        });
        paperIds.push(result.paperId);
      }
      setConfigureRepo(null);
      setSelectedFiles([]);

      // Auto-sync each paper in the background (don't block UI)
      for (const paperId of paperIds) {
        syncPaper({ paperId: paperId as Id<"papers"> }).catch((error) => {
          console.error("Failed to sync paper:", error);
        });
      }
    } catch (error) {
      console.error("Failed to add tracked files:", error);
      setToast({ message: "Failed to add files. Please try again.", type: "error" });
    } finally {
      setIsAddingFiles(false);
    }
  };

  // Overleaf credential handlers
  const handleSaveOverleafCredentials = async () => {
    if (!overleafEmail.trim() || !overleafToken.trim()) {
      setOverleafError("Please enter both email and token");
      return;
    }

    setIsSavingOverleaf(true);
    setOverleafError(null);
    try {
      await saveOverleafCredentials({
        email: overleafEmail.trim(),
        token: overleafToken.trim(),
      });
      setShowOverleafSetup(false);
      setOverleafEmail("");
      setOverleafToken("");
    } catch (error) {
      console.error("Failed to save Overleaf credentials:", error);
      setOverleafError("Failed to save credentials");
    } finally {
      setIsSavingOverleaf(false);
    }
  };

  const handleClearOverleafCredentials = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Disconnect Overleaf",
      message: "Are you sure you want to disconnect your Overleaf account? You will need to re-enter your credentials to access Overleaf projects.",
      variant: "warning",
      onConfirm: async () => {
        try {
          await clearOverleafCredentials();
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        } catch (error) {
          console.error("Failed to clear Overleaf credentials:", error);
          setToast({ message: "Failed to disconnect Overleaf account.", type: "error" });
        }
      },
    });
  };

  // Self-hosted GitLab handlers
  const handleAddSelfHostedGitLabRepository = async () => {
    if (!user || !selfHostedGitLabRepoUrl.trim()) return;

    setIsAddingSelfHostedGitLab(true);
    setAddError(null);
    try {
      // Fetch repo info to verify access and get default branch
      const repoInfo = await fetchRepoInfo({ gitUrl: selfHostedGitLabRepoUrl.trim() });

      await addRepository({
        userId: user._id,
        gitUrl: selfHostedGitLabRepoUrl.trim(),
        name: repoInfo.name,
        defaultBranch: repoInfo.defaultBranch,
      });
      setIsAddModalOpen(false);
      setSelfHostedGitLabRepoUrl("");
      setRepoSearch("");
    } catch (error) {
      console.error("Failed to add self-hosted GitLab repository:", error);
      const message = error instanceof Error ? error.message : "Failed to add self-hosted GitLab repository";
      setAddError(message);
    } finally {
      setIsAddingSelfHostedGitLab(false);
    }
  };

  const handleAddSelfHostedGitLabInstance = async () => {
    if (!selfHostedGitLabName.trim()) {
      setSelfHostedGitLabError("Please enter a name for this instance");
      return;
    }
    if (!selfHostedGitLabUrlInput.trim() || !selfHostedGitLabToken.trim()) {
      setSelfHostedGitLabError("Please enter both instance URL and token");
      return;
    }

    // Validate URL format
    try {
      new URL(selfHostedGitLabUrlInput.trim());
    } catch {
      setSelfHostedGitLabError("Please enter a valid URL (e.g., https://gitlab.mycompany.com)");
      return;
    }

    setIsSavingSelfHostedGitLab(true);
    setSelfHostedGitLabError(null);
    try {
      await addSelfHostedGitLabInstance({
        name: selfHostedGitLabName.trim(),
        url: selfHostedGitLabUrlInput.trim(),
        token: selfHostedGitLabToken.trim(),
      });
      setShowSelfHostedGitLabSetup(false);
      setSelfHostedGitLabName("");
      setSelfHostedGitLabUrlInput("");
      setSelfHostedGitLabToken("");
    } catch (error) {
      console.error("Failed to add self-hosted GitLab instance:", error);
      const message = error instanceof Error ? error.message : "Failed to add instance";
      setSelfHostedGitLabError(message);
    } finally {
      setIsSavingSelfHostedGitLab(false);
    }
  };

  const handleDeleteSelfHostedGitLabInstance = (instanceId: Id<"selfHostedGitLabInstances">, instanceName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete GitLab Instance",
      message: `Are you sure you want to delete "${instanceName}"? You will need to re-add this instance to access its repositories.`,
      variant: "danger",
      onConfirm: async () => {
        try {
          await deleteSelfHostedGitLabInstance({ id: instanceId });
          // Clear selection if we deleted the selected instance
          if (selectedSelfHostedInstance === instanceId) {
            setSelectedSelfHostedInstance(null);
            setSelfHostedGitLabRepoUrl("");
          }
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        } catch (error) {
          console.error("Failed to delete self-hosted GitLab instance:", error);
          setToast({ message: "Failed to delete GitLab instance.", type: "error" });
        }
      },
    });
  };

  // Repository name edit handlers
  const startEditingRepoName = (repoId: Id<"repositories">, currentName: string) => {
    setEditingRepoId(repoId);
    setEditingRepoName(currentName);
  };

  const saveRepoName = async () => {
    if (!editingRepoId || !editingRepoName.trim()) return;
    try {
      await updateRepository({
        id: editingRepoId,
        name: editingRepoName.trim(),
      });
    } catch (error) {
      console.error("Failed to update repository name:", error);
    }
    setEditingRepoId(null);
    setEditingRepoName("");
  };

  const cancelEditingRepoName = () => {
    setEditingRepoId(null);
    setEditingRepoName("");
  };

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const handleSyncAll = async () => {
    if (!repositories || repositories.length === 0) return;

    // Run quick sync on all repos in parallel
    const syncPromises = repositories
      .filter((repo) => repo.syncStatus !== "syncing")
      .map((repo) =>
        syncRepository({ repositoryId: repo._id }).catch((err) => {
          console.error(`Quick sync failed for ${repo.name}:`, err);
        })
      );

    await Promise.all(syncPromises);
  };

  const isSyncingAny = repositories?.some((repo) => repo.syncStatus === "syncing") ?? false;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Repositories</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSyncAll}
            disabled={isSyncingAny || !repositories || repositories.length === 0}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSyncingAny ? (
              <>
                <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Checking...
              </>
            ) : (
              <>
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Check All
              </>
            )}
          </button>
        <button
          onClick={() => {
            setIsAddModalOpen(true);
            setAddError(null);
            setGitUrl("");
            setActiveAddTab(hasGitHubToken ? "github" : (hasGitLabToken ? "gitlab" : "manual"));
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
            Add a GitHub, GitLab, or Overleaf repository to start tracking your LaTeX papers.
          </p>
          <button
            onClick={() => {
              setIsAddModalOpen(true);
              setAddError(null);
              setGitUrl("");
              setActiveAddTab(hasGitHubToken ? "github" : (hasGitLabToken ? "gitlab" : "manual"));
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
                  <div className="min-w-0 flex-1">
                    {editingRepoId === repo._id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingRepoName}
                          onChange={(e) => setEditingRepoName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRepoName();
                            if (e.key === "Escape") cancelEditingRepoName();
                          }}
                          autoFocus
                          className="w-full rounded border border-blue-300 px-2 py-1 text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={saveRepoName}
                          className="rounded p-1 text-green-600 hover:bg-green-50"
                          title="Save"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <button
                          onClick={cancelEditingRepoName}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100"
                          title="Cancel"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditingRepoName(repo._id, repo.name)}
                        className="group flex items-center gap-1 text-left"
                        title="Click to edit name"
                      >
                        <h3 className="font-medium text-gray-900">{repo.name}</h3>
                        <svg className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                    <p className="text-sm text-gray-500 truncate">{repo.gitUrl}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                      <span className="capitalize">{repo.provider}</span>
                      <span>Branch: {repo.defaultBranch}</span>
                      {repo.paperCount > 0 && (
                        <span>{repo.paperCount} paper{repo.paperCount !== 1 ? "s" : ""}</span>
                      )}
                      {repo.lastSyncedAt && (
                        <span>
                          Checked:{" "}
                          {new Date(repo.lastSyncedAt).toLocaleString()}
                        </span>
                      )}
                      {repo.syncStatus === "syncing" ? (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                          Syncing...
                        </span>
                      ) : repo.paperSyncStatus === "in_sync" ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          In sync
                        </span>
                      ) : repo.paperSyncStatus === "needs_sync" ? (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                          Needs sync
                        </span>
                      ) : repo.paperSyncStatus === "never_synced" ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                          Never synced
                        </span>
                      ) : null}
                      {repo.papersWithErrors > 0 && (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          {repo.papersWithErrors} error{repo.papersWithErrors !== 1 ? "s" : ""}
                        </span>
                      )}
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
                  setOverleafGitUrl("");
                  setSelfHostedGitLabRepoUrl("");
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

            <div className="border-b">
              <div className="flex">
                {[
                  { id: "github", label: "GitHub", icon: (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                  )},
                  { id: "gitlab", label: "GitLab", icon: (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 00.522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 00.522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 00-.957-.684.987.987 0 00-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 00-.942-.69h-.006z" />
                    </svg>
                  )},
                  { id: "overleaf", label: "Overleaf", icon: (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.377 15.377c-.468 3.687-3.103 6.534-6.415 7.416a8.333 8.333 0 01-2.129.207c-4.636 0-8.393-3.895-8.393-8.7 0-4.617 3.472-8.39 7.873-8.674.226-.015.451-.022.676-.022 1.85 0 3.582.604 5.01 1.637l-3.7 3.845c-.432-.172-.898-.266-1.384-.266-1.945 0-3.52 1.633-3.52 3.647 0 2.013 1.575 3.646 3.52 3.646 1.483 0 2.752-.94 3.282-2.269h-3.282v-2.768h6.462c.052.42.078.848.078 1.283 0 .4-.026.794-.078 1.183zM12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/>
                    </svg>
                  )},
                  { id: "selfhosted", label: "Self-Hosted", icon: (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                    </svg>
                  )},
                  { id: "manual", label: "Manual", icon: (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  )},
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveAddTab(tab.id as typeof activeAddTab)}
                    className={`relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors ${
                      activeAddTab === tab.id
                        ? "text-gray-900"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                    {activeAddTab === tab.id && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {activeAddTab === "github" && (
              <>
                <div className="border-b p-4">
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search your GitHub repositories..."
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                  {!hasGitHubToken ? (
                    <div className="py-8 text-center text-sm text-gray-500">
                      Connect GitHub to list repositories, or use the Manual tab.
                    </div>
                  ) : isLoadingRepos ? (
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
                  {addError && (
                    <p className="px-2 pb-2 text-sm text-red-600">{addError}</p>
                  )}
                </div>
              </>
            )}

            {activeAddTab === "gitlab" && (
              <>
                <div className="border-b p-4">
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search your GitLab repositories..."
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {!hasGitLabToken ? (
                    <div className="py-8 text-center text-sm text-gray-500">
                      Connect GitLab to list repositories, or use the Manual tab.
                    </div>
                  ) : isLoadingGitLabRepos ? (
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
                  ) : filteredGitLabRepos && filteredGitLabRepos.length > 0 ? (
                    <div className="space-y-1">
                      {filteredGitLabRepos.map((repo) => (
                        <button
                          key={repo.fullName}
                          onClick={() => handleAddFromGitLabList(repo)}
                          disabled={isAdding}
                          className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-gray-100 disabled:opacity-50"
                        >
                          {repo.ownerAvatar ? (
                            <img
                              src={repo.ownerAvatar}
                              alt=""
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-gray-200" />
                          )}
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
                  ) : gitlabRepos && filteredGitLabRepos?.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-500">
                      No repositories found matching "{repoSearch}"
                    </div>
                  ) : (
                    <div className="py-8 text-center text-sm text-gray-500">
                      No repositories available
                    </div>
                  )}
                  {addError && (
                    <p className="px-2 pb-2 text-sm text-red-600">{addError}</p>
                  )}
                </div>
                <div className="border-t p-4">
                  <p className="mb-2 text-xs text-gray-500">
                    Or add a GitLab repository by URL:
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={gitUrl}
                      onChange={(e) => {
                        setGitUrl(e.target.value);
                        setAddError(null);
                      }}
                      placeholder="https://gitlab.com/group/repo"
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
                      className="shrink-0 rounded-md bg-[#FC6D26] px-4 py-2 text-sm font-medium text-white hover:bg-[#E24329] disabled:opacity-50"
                    >
                      {isAdding ? "Adding..." : "Add"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeAddTab === "overleaf" && (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                    </svg>
                    <span className="text-sm font-medium text-gray-700">Overleaf</span>
                  </div>
                  {hasOverleafCreds ? (
                    <button
                      onClick={handleClearOverleafCredentials}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Disconnect
                    </button>
                  ) : null}
                </div>

                {hasOverleafCreds ? (
                  <div>
                    <p className="mb-2 text-xs text-gray-500">
                      Enter your Overleaf Git URL (find it in your project's Git menu):
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={overleafGitUrl}
                        onChange={(e) => {
                          setOverleafGitUrl(e.target.value);
                          setAddError(null);
                        }}
                        placeholder="https://git.overleaf.com/abc123def456..."
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !isAddingOverleaf && overleafGitUrl.trim()) {
                            handleAddOverleafRepository();
                          }
                        }}
                      />
                      <button
                        onClick={handleAddOverleafRepository}
                        disabled={isAddingOverleaf || !overleafGitUrl.trim()}
                        className="shrink-0 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {isAddingOverleaf ? "Adding..." : "Add"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setShowOverleafSetup(true);
                      setOverleafError(null);
                      setOverleafEmail("");
                      setOverleafToken("");
                    }}
                    className="w-full rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
                  >
                    Connect Overleaf Account
                  </button>
                )}
                {addError && (
                  <p className="mt-2 text-sm text-red-600">{addError}</p>
                )}
              </div>
            )}

            {activeAddTab === "selfhosted" && (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-[#554488]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 00.522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 00.522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 00-.957-.684.987.987 0 00-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 00-.942-.69h-.006z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700">Self-Hosted GitLab</span>
                  </div>
                  <button
                    onClick={() => {
                      setShowSelfHostedGitLabSetup(true);
                      setSelfHostedGitLabError(null);
                      setSelfHostedGitLabName("");
                      setSelfHostedGitLabUrlInput("");
                      setSelfHostedGitLabToken("");
                    }}
                    className="text-xs text-[#554488] hover:text-[#443377]"
                  >
                    + Add Instance
                  </button>
                </div>

                {selfHostedGitLabInstances && selfHostedGitLabInstances.length > 0 ? (
                  <div className="space-y-2">
                    <div className="space-y-2">
                      {selfHostedGitLabInstances.map((instance) => (
                        <div
                          key={instance._id}
                          className={`flex items-center justify-between rounded-md border p-2 ${
                            selectedSelfHostedInstance === instance._id
                              ? "border-[#554488] bg-[#554488]/5"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <button
                            onClick={() => setSelectedSelfHostedInstance(
                              selectedSelfHostedInstance === instance._id ? null : instance._id
                            )}
                            className="flex flex-1 items-center gap-2 text-left"
                          >
                            <input
                              type="radio"
                              checked={selectedSelfHostedInstance === instance._id}
                              onChange={() => {}}
                              className="h-4 w-4 text-[#554488]"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">{instance.name}</p>
                              <p className="truncate text-xs text-gray-500">{instance.url}</p>
                            </div>
                          </button>
                          <button
                            onClick={() => handleDeleteSelfHostedGitLabInstance(instance._id, instance.name)}
                            className="ml-2 shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            title="Delete instance"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>

                    {selectedSelfHostedInstance && (
                      <div className="mt-3">
                        <p className="mb-2 text-xs text-gray-500">
                          Enter repository URL from {selfHostedGitLabInstances.find(i => i._id === selectedSelfHostedInstance)?.name}:
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={selfHostedGitLabRepoUrl}
                            onChange={(e) => {
                              setSelfHostedGitLabRepoUrl(e.target.value);
                              setAddError(null);
                            }}
                            placeholder={`${selfHostedGitLabInstances.find(i => i._id === selectedSelfHostedInstance)?.url}/owner/repo`}
                            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !isAddingSelfHostedGitLab && selfHostedGitLabRepoUrl.trim()) {
                                handleAddSelfHostedGitLabRepository();
                              }
                            }}
                          />
                          <button
                            onClick={handleAddSelfHostedGitLabRepository}
                            disabled={isAddingSelfHostedGitLab || !selfHostedGitLabRepoUrl.trim()}
                            className="shrink-0 rounded-md bg-[#554488] px-4 py-2 text-sm font-medium text-white hover:bg-[#443377] disabled:opacity-50"
                          >
                            {isAddingSelfHostedGitLab ? "Adding..." : "Add"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-xs text-gray-500">
                    No self-hosted GitLab instances configured.
                  </p>
                )}
                {addError && (
                  <p className="mt-2 text-sm text-red-600">{addError}</p>
                )}
              </div>
            )}

            {activeAddTab === "manual" && (
              <div className="flex-1 overflow-y-auto p-4">
                <p className="mb-2 text-xs text-gray-500">Enter a repository URL manually:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={gitUrl}
                    onChange={(e) => {
                      setGitUrl(e.target.value);
                      setAddError(null);
                    }}
                    placeholder="https://github.com/user/repo or https://gitlab.com/user/repo"
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
            )}
          </div>
        </div>
      )}

      {/* Overleaf Credentials Modal */}
      {showOverleafSetup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Connect Overleaf Account</h3>
              <button
                onClick={() => setShowOverleafSetup(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-600">
              To access your Overleaf projects, you'll need your Overleaf email and a Git token.
              You can generate a Git token in your{" "}
              <a
                href="https://www.overleaf.com/user/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                Overleaf Account Settings
              </a>{" "}
              under "Git Integration".
            </p>

            <div className="space-y-4">
              <div>
                <label htmlFor="overleaf-email" className="block text-sm font-medium text-gray-700">
                  Overleaf Email
                </label>
                <input
                  id="overleaf-email"
                  type="email"
                  value={overleafEmail}
                  onChange={(e) => setOverleafEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="overleaf-token" className="block text-sm font-medium text-gray-700">
                  Git Token
                </label>
                <input
                  id="overleaf-token"
                  type="password"
                  value={overleafToken}
                  onChange={(e) => setOverleafToken(e.target.value)}
                  placeholder="Your Overleaf Git token"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {overleafError && (
                <p className="text-sm text-red-600">{overleafError}</p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowOverleafSetup(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveOverleafCredentials}
                  disabled={isSavingOverleaf || !overleafEmail.trim() || !overleafToken.trim()}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {isSavingOverleaf ? "Saving..." : "Save Credentials"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Self-hosted GitLab Instance Modal */}
      {showSelfHostedGitLabSetup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Add Self-Hosted GitLab Instance</h3>
              <button
                onClick={() => setShowSelfHostedGitLabSetup(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-600">
              To access your self-hosted GitLab repositories, you'll need your instance URL and a Personal Access Token (PAT).
              You can create a PAT in your GitLab{" "}
              <a
                href="https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                User Settings → Access Tokens
              </a>.
              Required scopes: <code className="rounded bg-gray-100 px-1 text-xs">read_api</code>, <code className="rounded bg-gray-100 px-1 text-xs">read_repository</code>.
            </p>

            <div className="space-y-4">
              <div>
                <label htmlFor="gitlab-name" className="block text-sm font-medium text-gray-700">
                  Instance Name
                </label>
                <input
                  id="gitlab-name"
                  type="text"
                  value={selfHostedGitLabName}
                  onChange={(e) => setSelfHostedGitLabName(e.target.value)}
                  placeholder="e.g., Work GitLab, University GitLab"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="gitlab-url" className="block text-sm font-medium text-gray-700">
                  GitLab Instance URL
                </label>
                <input
                  id="gitlab-url"
                  type="url"
                  value={selfHostedGitLabUrlInput}
                  onChange={(e) => setSelfHostedGitLabUrlInput(e.target.value)}
                  placeholder="https://gitlab.mycompany.com"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="gitlab-token" className="block text-sm font-medium text-gray-700">
                  Personal Access Token
                </label>
                <input
                  id="gitlab-token"
                  type="password"
                  value={selfHostedGitLabToken}
                  onChange={(e) => setSelfHostedGitLabToken(e.target.value)}
                  placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {selfHostedGitLabError && (
                <p className="text-sm text-red-600">{selfHostedGitLabError}</p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowSelfHostedGitLabSetup(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSelfHostedGitLabInstance}
                  disabled={isSavingSelfHostedGitLab || !selfHostedGitLabName.trim() || !selfHostedGitLabUrlInput.trim() || !selfHostedGitLabToken.trim()}
                  className="rounded-md bg-[#554488] px-4 py-2 text-sm font-medium text-white hover:bg-[#443377] disabled:opacity-50"
                >
                  {isSavingSelfHostedGitLab ? "Adding..." : "Add Instance"}
                </button>
              </div>
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

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />

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

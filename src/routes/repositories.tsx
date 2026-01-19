import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUser } from "../hooks/useUser";
import { ConfirmDialog, Toast } from "../components/ConfirmDialog";
import { RepositoryCard } from "../components/repositories/RepositoryCard";
import { AddRepositoryModal } from "../components/repositories/AddRepositoryModal";
import { ConfigureRepositoryModal } from "../components/repositories/ConfigureRepositoryModal";
import { OverleafSetupModal } from "../components/repositories/OverleafSetupModal";
import { SelfHostedGitLabSetupModal } from "../components/repositories/SelfHostedGitLabSetupModal";
import type { GitRepo, Repository, SelectedFile } from "../components/repositories/types";
import { useToast } from "../hooks/useToast";

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

  // Self-hosted GitLab instance management
  const selfHostedGitLabInstances = useQuery(api.users.getSelfHostedGitLabInstances);
  const addSelfHostedGitLabInstance = useMutation(api.users.addSelfHostedGitLabInstance);
  const deleteSelfHostedGitLabInstance = useMutation(api.users.deleteSelfHostedGitLabInstance);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [showOverleafSetup, setShowOverleafSetup] = useState(false);
  const [showSelfHostedGitLabSetup, setShowSelfHostedGitLabSetup] = useState(false);
  const [configureRepo, setConfigureRepo] = useState<Repository | null>(null);

  // Repository data states
  const [userRepos, setUserRepos] = useState<GitRepo[] | null>(null);
  const [gitlabRepos, setGitlabRepos] = useState<GitRepo[] | null>(null);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isLoadingGitLabRepos, setIsLoadingGitLabRepos] = useState(false);
  const [githubLoadError, setGithubLoadError] = useState<string | null>(null);
  const [gitlabLoadError, setGitlabLoadError] = useState<string | null>(null);

  // Sync state
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const hasQuickSyncedRef = useRef(false);

  // Confirm dialog and toast state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: "danger" | "warning" | "default";
    onConfirm: () => void | Promise<void>;
  }>({ isOpen: false, title: "", message: "", variant: "default", onConfirm: () => {} });
  const { toast, showError, showToast, clearToast } = useToast();

  const hasGitHubToken = Boolean(user?.hasGitHubToken);
  const hasGitLabToken = Boolean(user?.hasGitLabToken);

  // Quick sync all repositories on page load
  useEffect(() => {
    if (repositories && repositories.length > 0 && !hasQuickSyncedRef.current) {
      hasQuickSyncedRef.current = true;
      let hasErrors = false;
      const syncPromises = repositories
        .filter((repo) => repo.syncStatus !== "syncing")
        .map((repo) =>
          syncRepository({ repositoryId: repo._id }).catch((err) => {
            console.error(`Quick sync failed for ${repo.name}:`, err);
            hasErrors = true;
          })
        );
      Promise.all(syncPromises).then(() => {
        if (hasErrors) {
          showToast("Some repositories failed to sync", "info");
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories]);

  // Load user repos when GitHub tab is active
  useEffect(() => {
    if (isAddModalOpen && hasGitHubToken && userRepos === null && !isLoadingRepos && !githubLoadError) {
      setIsLoadingRepos(true);
      setGithubLoadError(null);
      listUserRepos()
        .then(setUserRepos)
        .catch((err) => {
          console.error("Failed to load repos:", err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          setGithubLoadError(errorMessage);
          setUserRepos([]);
        })
        .finally(() => setIsLoadingRepos(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddModalOpen, hasGitHubToken, userRepos, isLoadingRepos, githubLoadError, listUserRepos]);

  // Load GitLab repos when modal is open
  useEffect(() => {
    if (isAddModalOpen && hasGitLabToken && gitlabRepos === null && !isLoadingGitLabRepos && !gitlabLoadError) {
      setIsLoadingGitLabRepos(true);
      setGitlabLoadError(null);
      listUserGitLabRepos()
        .then(setGitlabRepos)
        .catch((err) => {
          console.error("Failed to load GitLab repos:", err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          setGitlabLoadError(errorMessage);
          setGitlabRepos([]);
        })
        .finally(() => setIsLoadingGitLabRepos(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddModalOpen, hasGitLabToken, gitlabRepos, isLoadingGitLabRepos, gitlabLoadError, listUserGitLabRepos]);

  // Handlers
  const handleAddFromUrl = async (gitUrl: string) => {
    if (!user) return;
    const repoInfo = await fetchRepoInfo({ gitUrl });
    await addRepository({
      userId: user._id,
      gitUrl,
      name: repoInfo.name,
      defaultBranch: repoInfo.defaultBranch,
    });
    setIsAddModalOpen(false);
  };

  const handleAddFromList = async (repo: GitRepo) => {
    if (!user) return;
    await addRepository({
      userId: user._id,
      gitUrl: repo.url,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
    });
    setIsAddModalOpen(false);
  };

  const handleAddOverleafRepo = async (gitUrl: string) => {
    if (!user) return;
    const repoInfo = await fetchRepoInfo({ gitUrl });
    await addRepository({
      userId: user._id,
      gitUrl,
      name: repoInfo.name,
      defaultBranch: repoInfo.defaultBranch,
    });
    setIsAddModalOpen(false);
  };

  const handleAddSelfHostedRepo = async (gitUrl: string) => {
    if (!user) return;
    const repoInfo = await fetchRepoInfo({ gitUrl });
    await addRepository({
      userId: user._id,
      gitUrl,
      name: repoInfo.name,
      defaultBranch: repoInfo.defaultBranch,
    });
    setIsAddModalOpen(false);
  };

  const handleSync = async (repoId: Id<"repositories">) => {
    setSyncingRepoId(repoId);
    try {
      await syncRepository({ repositoryId: repoId });
    } catch (error) {
      console.error("Failed to sync repository:", error);
      showError(error, "Failed to sync repository");
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
          showError(error, "Failed to delete repository");
        }
      },
    });
  };

  const handleUpdateName = async (repoId: Id<"repositories">, name: string) => {
    try {
      await updateRepository({ id: repoId, name });
    } catch (error) {
      console.error("Failed to update repository name:", error);
      showError(error, "Failed to update repository name");
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
          showError(error, "Failed to disconnect Overleaf account");
        }
      },
    });
  };

  const handleDeleteSelfHostedInstance = (instanceId: string, instanceName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete GitLab Instance",
      message: `Are you sure you want to delete "${instanceName}"? You will need to re-add this instance to access its repositories.`,
      variant: "danger",
      onConfirm: async () => {
        try {
          await deleteSelfHostedGitLabInstance({ id: instanceId as Id<"selfHostedGitLabInstances"> });
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        } catch (error) {
          console.error("Failed to delete self-hosted GitLab instance:", error);
          showError(error, "Failed to delete GitLab instance");
        }
      },
    });
  };

  const handleSaveOverleafCredentials = async (email: string, token: string) => {
    await saveOverleafCredentials({ email, token });
  };

  const handleAddSelfHostedInstance = async (name: string, url: string, token: string) => {
    await addSelfHostedGitLabInstance({ name, url, token });
  };

  const handleAddTrackedFiles = async (files: SelectedFile[]) => {
    if (!configureRepo) return;
    const paperIds: string[] = [];
    try {
      for (const file of files) {
        const result = await addTrackedFile({
          repositoryId: configureRepo._id,
          filePath: file.path,
          title: file.title,
          pdfSourceType: file.pdfSourceType,
        });
        paperIds.push(result.paperId);
      }
    } catch (error) {
      console.error("Failed to add tracked files:", error);
      showError(error, "Failed to add tracked files");
      return;
    }

    // Auto-sync each paper in the background
    for (const paperId of paperIds) {
      syncPaper({ paperId: paperId as Id<"papers"> }).catch((error) => {
        console.error("Failed to sync paper:", error);
      });
    }
  };

  const handleSyncAll = async () => {
    if (!repositories || repositories.length === 0) return;
    let failedCount = 0;
    const syncPromises = repositories
      .filter((repo) => repo.syncStatus !== "syncing")
      .map((repo) =>
        syncRepository({ repositoryId: repo._id }).catch((err) => {
          console.error(`Quick sync failed for ${repo.name}:`, err);
          failedCount++;
        })
      );
    await Promise.all(syncPromises);
    if (failedCount > 0) {
      showToast(`${failedCount} ${failedCount === 1 ? "repository" : "repositories"} failed to sync`, "error");
    }
  };

  // Transform repositories to match the expected type
  const transformedRepos: Repository[] = useMemo(() => {
    return (repositories ?? []).map(repo => ({
      _id: repo._id,
      name: repo.name,
      gitUrl: repo.gitUrl,
      defaultBranch: repo.defaultBranch,
      provider: repo.provider,
      paperCount: repo.paperCount,
      lastSyncedAt: repo.lastSyncedAt,
      syncStatus: repo.syncStatus,
      paperSyncStatus: repo.paperSyncStatus,
      papersWithErrors: repo.papersWithErrors,
    }));
  }, [repositories]);

  const selfHostedInstances = useMemo(() => {
    return selfHostedGitLabInstances?.map(instance => ({
      _id: instance._id,
      name: instance.name,
      url: instance.url,
    }));
  }, [selfHostedGitLabInstances]);

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  const isSyncingAny = repositories?.some((repo) => repo.syncStatus === "syncing") ?? false;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-2xl font-semibold text-gray-900 dark:text-gray-100">Repositories</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSyncAll}
            disabled={isSyncingAny || !repositories || repositories.length === 0}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
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
                          }}
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Repository
          </button>
        </div>
      </div>

      {/* Repository List */}
      {repositories === undefined ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500 dark:text-gray-400">Loading repositories...</div>
        </div>
      ) : repositories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
          <div className="mb-4 rounded-full bg-gray-100 p-4 dark:bg-gray-800">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <h3 className="mb-1 text-lg font-medium text-gray-900 dark:text-gray-100">No repositories connected</h3>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Add a GitHub, GitLab, or Overleaf repository to start tracking your LaTeX papers.
          </p>
          <button
            onClick={() => {
              setIsAddModalOpen(true);
                          }}
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Add Repository
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {transformedRepos.map((repo) => (
            <RepositoryCard
              key={repo._id}
              repo={repo}
              isSyncing={syncingRepoId === repo._id}
              onSync={() => handleSync(repo._id)}
              onDelete={() => handleDelete(repo._id)}
              onConfigure={() => setConfigureRepo(repo)}
              onUpdateName={(name) => handleUpdateName(repo._id, name)}
            />
          ))}
        </div>
      )}

      {/* Add Repository Modal */}
      {isAddModalOpen && (
        <AddRepositoryModal
          initialTab={hasGitHubToken ? "github" : hasGitLabToken ? "gitlab" : "manual"}
          hasGitHubToken={hasGitHubToken}
          hasGitLabToken={hasGitLabToken}
          hasOverleafCreds={hasOverleafCreds}
          selfHostedInstances={selfHostedInstances}
          userRepos={userRepos}
          gitlabRepos={gitlabRepos}
          isLoadingRepos={isLoadingRepos}
          isLoadingGitLabRepos={isLoadingGitLabRepos}
          githubLoadError={githubLoadError}
          gitlabLoadError={gitlabLoadError}
          onClose={() => setIsAddModalOpen(false)}
          onAddFromUrl={handleAddFromUrl}
          onAddFromList={handleAddFromList}
          onAddOverleafRepo={handleAddOverleafRepo}
          onAddSelfHostedRepo={handleAddSelfHostedRepo}
          onShowOverleafSetup={() => setShowOverleafSetup(true)}
          onShowSelfHostedSetup={() => setShowSelfHostedGitLabSetup(true)}
          onClearOverleafCredentials={handleClearOverleafCredentials}
          onDeleteSelfHostedInstance={handleDeleteSelfHostedInstance}
        />
      )}

      {/* Overleaf Setup Modal */}
      {showOverleafSetup && (
        <OverleafSetupModal
          onClose={() => setShowOverleafSetup(false)}
          onSave={handleSaveOverleafCredentials}
        />
      )}

      {/* Self-hosted GitLab Setup Modal */}
      {showSelfHostedGitLabSetup && (
        <SelfHostedGitLabSetupModal
          onClose={() => setShowSelfHostedGitLabSetup(false)}
          onSave={handleAddSelfHostedInstance}
        />
      )}

      {/* Configure Repository Modal */}
      {configureRepo && (
        <ConfigureRepositoryModal
          repo={configureRepo}
          onClose={() => setConfigureRepo(null)}
          onAddFiles={handleAddTrackedFiles}
          listRepositoryFiles={listRepositoryFiles}
        />
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
          onClose={clearToast}
        />
      )}
    </div>
  );
}

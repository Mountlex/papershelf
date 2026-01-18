import { useState, useMemo } from "react";
import type { AddRepositoryTab, GitRepo, SelfHostedGitLabInstance } from "../types";
import { GitHubTab } from "./GitHubTab";
import { GitLabTab } from "./GitLabTab";
import { OverleafTab } from "./OverleafTab";
import { SelfHostedTab } from "./SelfHostedTab";
import { ManualTab } from "./ManualTab";

interface AddRepositoryModalProps {
  initialTab: AddRepositoryTab;
  hasGitHubToken: boolean;
  hasGitLabToken: boolean;
  hasOverleafCreds: boolean | undefined;
  selfHostedInstances: SelfHostedGitLabInstance[] | undefined;
  userRepos: GitRepo[] | null;
  gitlabRepos: GitRepo[] | null;
  isLoadingRepos: boolean;
  isLoadingGitLabRepos: boolean;
  onClose: () => void;
  onAddFromUrl: (url: string) => Promise<void>;
  onAddFromList: (repo: GitRepo) => Promise<void>;
  onAddOverleafRepo: (url: string) => Promise<void>;
  onAddSelfHostedRepo: (url: string) => Promise<void>;
  onShowOverleafSetup: () => void;
  onShowSelfHostedSetup: () => void;
  onClearOverleafCredentials: () => void;
  onDeleteSelfHostedInstance: (id: string, name: string) => void;
}

export function AddRepositoryModal({
  initialTab,
  hasGitHubToken,
  hasGitLabToken,
  hasOverleafCreds,
  selfHostedInstances,
  userRepos,
  gitlabRepos,
  isLoadingRepos,
  isLoadingGitLabRepos,
  onClose,
  onAddFromUrl,
  onAddFromList,
  onAddOverleafRepo,
  onAddSelfHostedRepo,
  onShowOverleafSetup,
  onShowSelfHostedSetup,
  onClearOverleafCredentials,
  onDeleteSelfHostedInstance,
}: AddRepositoryModalProps) {
  const [activeTab, setActiveTab] = useState<AddRepositoryTab>(initialTab);
  const [repoSearch, setRepoSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL input states for different tabs
  const [gitUrl, setGitUrl] = useState("");
  const [overleafGitUrl, setOverleafGitUrl] = useState("");
  const [selfHostedGitLabRepoUrl, setSelfHostedGitLabRepoUrl] = useState("");
  const [selectedSelfHostedInstance, setSelectedSelfHostedInstance] = useState<string | null>(null);

  const filteredRepos = useMemo(() => {
    return userRepos?.filter((repo) => {
      const query = repoSearch.toLowerCase();
      const description = (repo.description ?? "").toLowerCase();
      return (
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query) ||
        description.includes(query)
      );
    });
  }, [userRepos, repoSearch]);

  const filteredGitLabRepos = useMemo(() => {
    return gitlabRepos?.filter((repo) => {
      const query = repoSearch.toLowerCase();
      const description = (repo.description ?? "").toLowerCase();
      return (
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query) ||
        description.includes(query)
      );
    });
  }, [gitlabRepos, repoSearch]);

  const getRepositoryErrorMessage = (err: unknown): string => {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("already") || message.includes("exists") || message.includes("duplicate")) {
      return "This repository has already been added to your collection.";
    }
    if (message.includes("401") || message.includes("403") || message.includes("permission")) {
      return "Unable to access this repository. Please check your permissions.";
    }
    if (message.includes("404") || message.includes("not found")) {
      return "Repository not found. Please check the URL and try again.";
    }
    if (message.includes("network") || message.includes("fetch")) {
      return "Network error. Please check your connection and try again.";
    }
    return message || "Failed to add repository. Please try again.";
  };

  const handleAddFromList = async (repo: GitRepo) => {
    setIsAdding(true);
    setError(null);
    try {
      await onAddFromList(repo);
    } catch (err) {
      setError(getRepositoryErrorMessage(err));
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddFromUrl = async (url: string) => {
    setIsAdding(true);
    setError(null);
    try {
      await onAddFromUrl(url);
    } catch (err) {
      setError(getRepositoryErrorMessage(err));
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddOverleafRepo = async (url: string) => {
    setIsAdding(true);
    setError(null);
    try {
      await onAddOverleafRepo(url);
    } catch (err) {
      setError(getRepositoryErrorMessage(err));
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddSelfHostedRepo = async (url: string) => {
    setIsAdding(true);
    setError(null);
    try {
      await onAddSelfHostedRepo(url);
    } catch (err) {
      setError(getRepositoryErrorMessage(err));
    } finally {
      setIsAdding(false);
    }
  };

  const tabs = [
    { id: "github" as const, label: "GitHub", icon: <GitHubIconSmall /> },
    { id: "gitlab" as const, label: "GitLab", icon: <GitLabIconSmall /> },
    { id: "overleaf" as const, label: "Overleaf", icon: <OverleafIconSmall /> },
    { id: "selfhosted" as const, label: "Self-Hosted", icon: <ServerIconSmall /> },
    { id: "manual" as const, label: "Manual", icon: <EditIconSmall /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Repository</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="border-b dark:border-gray-700">
          <div className="flex">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "text-gray-900 dark:text-gray-100"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 dark:bg-gray-100" />
                )}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "github" && (
          <GitHubTab
            hasToken={hasGitHubToken}
            repos={filteredRepos}
            isLoading={isLoadingRepos}
            isAdding={isAdding}
            error={error}
            search={repoSearch}
            onSearchChange={setRepoSearch}
            onAddRepo={handleAddFromList}
          />
        )}

        {activeTab === "gitlab" && (
          <GitLabTab
            hasToken={hasGitLabToken}
            repos={filteredGitLabRepos}
            isLoading={isLoadingGitLabRepos}
            isAdding={isAdding}
            error={error}
            search={repoSearch}
            onSearchChange={setRepoSearch}
            onAddRepo={handleAddFromList}
            onAddFromUrl={handleAddFromUrl}
            urlValue={gitUrl}
            onUrlChange={(url) => {
              setGitUrl(url);
              setError(null);
            }}
          />
        )}

        {activeTab === "overleaf" && (
          <OverleafTab
            hasCredentials={hasOverleafCreds}
            isAdding={isAdding}
            error={error}
            urlValue={overleafGitUrl}
            onUrlChange={(url) => {
              setOverleafGitUrl(url);
              setError(null);
            }}
            onAddRepo={handleAddOverleafRepo}
            onShowSetup={onShowOverleafSetup}
            onClearCredentials={onClearOverleafCredentials}
          />
        )}

        {activeTab === "selfhosted" && (
          <SelfHostedTab
            instances={selfHostedInstances}
            selectedInstanceId={selectedSelfHostedInstance}
            onSelectInstance={(id) => {
              setSelectedSelfHostedInstance(id);
              setSelfHostedGitLabRepoUrl("");
            }}
            isAdding={isAdding}
            error={error}
            urlValue={selfHostedGitLabRepoUrl}
            onUrlChange={(url) => {
              setSelfHostedGitLabRepoUrl(url);
              setError(null);
            }}
            onAddRepo={handleAddSelfHostedRepo}
            onShowSetup={onShowSelfHostedSetup}
            onDeleteInstance={onDeleteSelfHostedInstance}
          />
        )}

        {activeTab === "manual" && (
          <ManualTab
            isAdding={isAdding}
            error={error}
            urlValue={gitUrl}
            onUrlChange={(url) => {
              setGitUrl(url);
              setError(null);
            }}
            onAddFromUrl={handleAddFromUrl}
          />
        )}
      </div>
    </div>
  );
}

function GitHubIconSmall() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function GitLabIconSmall() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 00.522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 00.522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 00-.957-.684.987.987 0 00-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 00-.942-.69h-.006z" />
    </svg>
  );
}

function OverleafIconSmall() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.377 15.377c-.468 3.687-3.103 6.534-6.415 7.416a8.333 8.333 0 01-2.129.207c-4.636 0-8.393-3.895-8.393-8.7 0-4.617 3.472-8.39 7.873-8.674.226-.015.451-.022.676-.022 1.85 0 3.582.604 5.01 1.637l-3.7 3.845c-.432-.172-.898-.266-1.384-.266-1.945 0-3.52 1.633-3.52 3.647 0 2.013 1.575 3.646 3.52 3.646 1.483 0 2.752-.94 3.282-2.269h-3.282v-2.768h6.462c.052.42.078.848.078 1.283 0 .4-.026.794-.078 1.183zM12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/>
    </svg>
  );
}

function ServerIconSmall() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  );
}

function EditIconSmall() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

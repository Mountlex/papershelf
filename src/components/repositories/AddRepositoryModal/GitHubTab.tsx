import type { GitRepo } from "../types";

interface GitHubTabProps {
  hasToken: boolean;
  repos: GitRepo[] | undefined;
  isLoading: boolean;
  isAdding: boolean;
  error: string | null;
  search: string;
  onSearchChange: (search: string) => void;
  onAddRepo: (repo: GitRepo) => void;
}

export function GitHubTab({
  hasToken,
  repos,
  isLoading,
  isAdding,
  error,
  search,
  onSearchChange,
  onAddRepo,
}: GitHubTabProps) {
  return (
    <>
      <div className="border-b p-4 dark:border-gray-700">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search your GitHub repositories..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!hasToken ? (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Connect GitHub to list repositories, or use the Manual tab.
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <svg className="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">Loading repositories...</span>
          </div>
        ) : repos && repos.length > 0 ? (
          <div className="space-y-1">
            {repos.map((repo) => (
              <RepoListItem
                key={repo.fullName}
                repo={repo}
                isAdding={isAdding}
                onAdd={onAddRepo}
              />
            ))}
          </div>
        ) : repos && repos.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No repositories found matching "{search}"
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No repositories available
          </div>
        )}
        {error && <p className="px-2 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </>
  );
}

function RepoListItem({
  repo,
  isAdding,
  onAdd,
}: {
  repo: GitRepo;
  isAdding: boolean;
  onAdd: (repo: GitRepo) => void;
}) {
  return (
    <button
      onClick={() => onAdd(repo)}
      disabled={isAdding}
      className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
    >
      <img src={repo.ownerAvatar} alt="" className="h-8 w-8 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-gray-900 dark:text-gray-100">{repo.fullName}</span>
          {repo.isPrivate && (
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
              Private
            </span>
          )}
        </div>
        {repo.description && (
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{repo.description}</p>
        )}
      </div>
    </button>
  );
}

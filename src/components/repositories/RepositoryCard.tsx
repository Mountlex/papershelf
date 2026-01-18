import { useState } from "react";
import type { Repository } from "./types";
import type { Id } from "../../../convex/_generated/dataModel";

interface RepositoryCardProps {
  repo: Repository;
  isSyncing: boolean;
  onSync: (repoId: Id<"repositories">) => void;
  onDelete: (repoId: Id<"repositories">) => void;
  onConfigure: (repo: Repository) => void;
  onUpdateName: (repoId: Id<"repositories">, name: string) => Promise<void>;
}

export function RepositoryCard({
  repo,
  isSyncing,
  onSync,
  onDelete,
  onConfigure,
  onUpdateName,
}: RepositoryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(repo.name);

  const handleSave = async () => {
    if (!editName.trim()) return;
    await onUpdateName(repo._id, editName.trim());
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(repo.name);
    setIsEditing(false);
  };

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <div className="rounded-full bg-gray-100 p-2 dark:bg-gray-700">
            <svg
              className="h-5 w-5 text-gray-600 dark:text-gray-400"
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
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                    if (e.key === "Escape") handleCancel();
                  }}
                  autoFocus
                  className="w-full rounded border border-blue-300 px-2 py-1 text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-blue-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  onClick={handleSave}
                  className="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30"
                  title="Save"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  onClick={handleCancel}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Cancel"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setEditName(repo.name);
                  setIsEditing(true);
                }}
                className="group flex items-center gap-1 text-left"
                title="Click to edit name"
              >
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{repo.name}</h3>
                <svg className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
            <p className="text-sm text-gray-500 truncate dark:text-gray-400">{repo.gitUrl}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 dark:text-gray-500">
              <span className="capitalize">{repo.provider}</span>
              <span>Branch: {repo.defaultBranch}</span>
              {repo.paperCount > 0 && (
                <span>{repo.paperCount} paper{repo.paperCount !== 1 ? "s" : ""}</span>
              )}
              {repo.lastSyncedAt && (
                <span>
                  Checked: {new Date(repo.lastSyncedAt).toLocaleString()}
                </span>
              )}
              <SyncStatusBadge repo={repo} />
              {repo.papersWithErrors > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
                  {repo.papersWithErrors} error{repo.papersWithErrors !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onConfigure(repo)}
            className="inline-flex items-center rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-blue-600 dark:bg-gray-800 dark:text-blue-400 dark:hover:bg-blue-900/30"
          >
            <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Configure
          </button>
          <button
            onClick={() => onSync(repo._id)}
            disabled={isSyncing}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {isSyncing ? (
              <>
                <svg className="mr-1 h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Syncing
              </>
            ) : (
              <>
                <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Sync
              </>
            )}
          </button>
          <button
            onClick={() => onDelete(repo._id)}
            className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function SyncStatusBadge({ repo }: { repo: Repository }) {
  if (repo.syncStatus === "syncing") {
    return (
      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        Syncing...
      </span>
    );
  }
  if (repo.paperSyncStatus === "in_sync") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
        In sync
      </span>
    );
  }
  if (repo.paperSyncStatus === "needs_sync") {
    return (
      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        Needs sync
      </span>
    );
  }
  if (repo.paperSyncStatus === "never_synced") {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-300">
        Never synced
      </span>
    );
  }
  return null;
}

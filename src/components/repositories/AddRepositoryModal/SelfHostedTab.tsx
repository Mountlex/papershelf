import type { SelfHostedGitLabInstance } from "../types";

interface SelfHostedTabProps {
  instances: SelfHostedGitLabInstance[] | undefined;
  selectedInstanceId: string | null;
  onSelectInstance: (id: string | null) => void;
  isAdding: boolean;
  error: string | null;
  urlValue: string;
  onUrlChange: (url: string) => void;
  onAddRepo: (url: string) => void;
  onShowSetup: () => void;
  onDeleteInstance: (id: string, name: string) => void;
}

export function SelfHostedTab({
  instances,
  selectedInstanceId,
  onSelectInstance,
  isAdding,
  error,
  urlValue,
  onUrlChange,
  onAddRepo,
  onShowSetup,
  onDeleteInstance,
}: SelfHostedTabProps) {
  const selectedInstance = instances?.find(i => i._id === selectedInstanceId);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-[#554488]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 00.522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 00.522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 00-.957-.684.987.987 0 00-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 00-.942-.69h-.006z" />
          </svg>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Self-Hosted GitLab</span>
        </div>
        <button
          onClick={onShowSetup}
          className="text-xs text-[#554488] hover:text-[#443377] dark:text-[#8877bb] dark:hover:text-[#9988cc]"
        >
          + Add Instance
        </button>
      </div>

      {instances && instances.length > 0 ? (
        <div className="space-y-2">
          <div className="space-y-2">
            {instances.map((instance) => (
              <div
                key={instance._id}
                className={`flex items-center justify-between rounded-md border p-2 ${
                  selectedInstanceId === instance._id
                    ? "border-[#554488] bg-[#554488]/5 dark:bg-[#554488]/20"
                    : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
                }`}
              >
                <button
                  onClick={() => onSelectInstance(
                    selectedInstanceId === instance._id ? null : instance._id
                  )}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <input
                    type="radio"
                    checked={selectedInstanceId === instance._id}
                    onChange={() => {}}
                    className="h-4 w-4 text-[#554488]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{instance.name}</p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">{instance.url}</p>
                  </div>
                </button>
                <button
                  onClick={() => onDeleteInstance(instance._id, instance.name)}
                  className="ml-2 shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  title="Delete instance"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {selectedInstanceId && selectedInstance && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                Enter repository URL from {selectedInstance.name}:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={urlValue}
                  onChange={(e) => onUrlChange(e.target.value)}
                  placeholder={`${selectedInstance.url}/owner/repo`}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isAdding && urlValue.trim()) {
                      onAddRepo(urlValue.trim());
                    }
                  }}
                />
                <button
                  onClick={() => onAddRepo(urlValue.trim())}
                  disabled={isAdding || !urlValue.trim()}
                  className="shrink-0 rounded-md bg-[#554488] px-4 py-2 text-sm font-medium text-white hover:bg-[#443377] disabled:opacity-50"
                >
                  {isAdding ? "Adding..." : "Add"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">
          No self-hosted GitLab instances configured.
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

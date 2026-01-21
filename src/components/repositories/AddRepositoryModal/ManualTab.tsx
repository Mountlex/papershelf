interface ManualTabProps {
  isAdding: boolean;
  error: string | null;
  urlValue: string;
  onUrlChange: (url: string) => void;
  onAddFromUrl: (url: string) => void;
}

export function ManualTab({
  isAdding,
  error,
  urlValue,
  onUrlChange,
  onAddFromUrl,
}: ManualTabProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Enter a repository URL manually:</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={urlValue}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://github.com/user/repo or https://gitlab.com/user/repo"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isAdding && urlValue.trim()) {
              onAddFromUrl(urlValue.trim());
            }
          }}
        />
        <button
          onClick={() => onAddFromUrl(urlValue.trim())}
          disabled={isAdding || !urlValue.trim()}
          className="shrink-0 rounded-md border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-normal text-gray-900 dark:text-gray-100 hover:bg-primary-100 disabled:opacity-50"
        >
          {isAdding ? "Adding..." : "Add"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

interface BuildProgressProps {
  status: "idle" | "building" | "error" | undefined;
  progress: string | undefined;
  isCompile: boolean;
}

export function BuildProgress({ status, progress, isCompile }: BuildProgressProps) {
  if (status !== "building") {
    return null;
  }

  return (
    <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="font-medium">
          {isCompile ? "Compiling LaTeX..." : "Fetching PDF..."}
        </span>
      </div>
      {progress && (
        <p className="mt-1 text-xs opacity-80">{progress}</p>
      )}
    </div>
  );
}

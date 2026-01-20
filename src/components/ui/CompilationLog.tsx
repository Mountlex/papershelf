import { useState } from "react";

interface CompilationLogProps {
  error: string;
}

export function CompilationLog({ error }: CompilationLogProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Parse the error to separate the message from the log
  const logSeparator = "\n\nLog:\n";
  const separatorIndex = error.indexOf(logSeparator);

  const hasLog = separatorIndex !== -1;
  const errorMessage = hasLog ? error.slice(0, separatorIndex) : error;
  const logContent = hasLog ? error.slice(separatorIndex + logSeparator.length) : null;

  return (
    <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
      <p className="font-medium">{errorMessage}</p>

      {logContent && (
        <div className="mt-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
          >
            <svg
              className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {isExpanded ? "Hide compilation log" : "Show compilation log"}
          </button>

          {isExpanded && (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100 dark:bg-gray-950">
              {logContent}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

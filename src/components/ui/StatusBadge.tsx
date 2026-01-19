import type { ReactNode } from "react";

type StatusType = "success" | "warning" | "error" | "info";

interface StatusBadgeProps {
  status: StatusType;
  label: string;
  icon?: ReactNode;
  title?: string;
  className?: string;
}

const statusStyles: Record<StatusType, string> = {
  success: "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950",
  warning: "text-yellow-700 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950",
  error: "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950",
  info: "text-purple-700 bg-purple-50 dark:text-purple-400 dark:bg-purple-950",
};

const defaultIcons: Record<StatusType, ReactNode> = {
  success: (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  warning: (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  error: (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  info: (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  ),
};

export function StatusBadge({
  status,
  label,
  icon,
  title,
  className = "",
}: StatusBadgeProps) {
  const displayIcon = icon ?? defaultIcons[status];

  return (
    <span
      role="status"
      aria-label={title || label}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[status]} ${className}`}
    >
      {displayIcon}
      <span>{label}</span>
    </span>
  );
}

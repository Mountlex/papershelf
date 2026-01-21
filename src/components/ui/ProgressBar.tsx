interface ProgressBarProps {
  current: number;
  total: number;
  label?: string;
  showCount?: boolean;
  className?: string;
}

export function ProgressBar({
  current,
  total,
  label,
  showCount = true,
  className = "",
}: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className={`w-full ${className}`}>
      {(label || showCount) && (
        <div className="mb-1 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
          {label && <span>{label}</span>}
          {showCount && (
            <span>
              {current}/{total}
            </span>
          )}
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label || `Progress: ${current} of ${total}`}
      >
        <div
          className="h-full rounded-full bg-primary-400 transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

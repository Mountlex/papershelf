export function PaperCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      {/* Thumbnail skeleton */}
      <div className="aspect-[8.5/11] w-full animate-pulse bg-gray-200 dark:bg-gray-800" />

      {/* Info skeleton */}
      <div className="p-4">
        <div className="flex items-start gap-1">
          <div className="h-5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-3 flex items-center justify-between">
          <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    </div>
  );
}

export function PaperCardSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <PaperCardSkeleton key={i} />
      ))}
    </div>
  );
}

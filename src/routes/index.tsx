import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "../hooks/useUser";

export const Route = createFileRoute("/")({
  component: GalleryPage,
});

function GalleryPage() {
  const { user, isLoading: isUserLoading, isAuthenticated } = useUser();
  const papers = useQuery(api.papers.list, isAuthenticated && user ? { userId: user._id } : "skip");

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Your Papers</h1>
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Search papers..."
            className="rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {papers === undefined ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading papers...</div>
        </div>
      ) : papers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <div className="mb-4 rounded-full bg-gray-100 p-4">
            <svg
              className="h-8 w-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h3 className="mb-1 text-lg font-medium text-gray-900">
            No papers yet
          </h3>
          <p className="mb-4 text-sm text-gray-500">
            Connect a repository to start tracking your papers.
          </p>
          <Link
            to="/repositories"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Add Repository
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {papers.map((paper) => (
            <Link
              key={paper._id}
              to="/papers/$id"
              params={{ id: paper._id }}
              className="group overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Thumbnail */}
              <div className="aspect-[8.5/11] w-full bg-gray-100">
                {paper.thumbnailUrl ? (
                  <img
                    src={paper.thumbnailUrl}
                    alt={paper.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400">
                    <svg
                      className="h-12 w-12"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3">
                <h3 className="truncate font-medium text-gray-900 group-hover:text-blue-600">
                  {paper.title}
                </h3>
                {paper.authors && paper.authors.length > 0 && (
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {paper.authors.join(", ")}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                  {paper.repository && (
                    <span className="truncate">{paper.repository.name}</span>
                  )}
                  <span className="flex items-center">
                    {paper.isPublic ? (
                      <span className="flex items-center text-green-600">
                        <svg
                          className="mr-1 h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                        Public
                      </span>
                    ) : (
                      <span className="flex items-center">
                        <svg
                          className="mr-1 h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                          />
                        </svg>
                        Private
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

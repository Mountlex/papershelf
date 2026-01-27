import { createFileRoute, Link } from "@tanstack/react-router";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { api } from "../../convex/_generated/api";
import { PdfViewer } from "../components/PdfViewer";

export const Route = createFileRoute("/share/$slug")({
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.papers.getByShareSlug, { slug: params.slug })
    );
  },
  head: () => ({
    meta: [
      { title: "Shared Paper - Carrel" },
      { property: "og:title", content: "Shared Paper - Carrel" },
      { property: "og:type", content: "article" },
      { property: "og:description", content: "View this academic paper on Carrel" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SharePage,
  errorComponent: SharePageError,
});

function SharePageError({ error }: { error: Error }) {
  const isNetworkError = error.message?.toLowerCase().includes("network") ||
                         error.message?.toLowerCase().includes("fetch");

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="mb-4 rounded-full bg-red-100 p-4 dark:bg-red-900/30">
        <svg
          className="h-8 w-8 text-red-600 dark:text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <h2 className="text-lg font-normal text-gray-900 dark:text-gray-100">
        {isNetworkError ? "Connection Error" : "Unable to Load Paper"}
      </h2>
      <p className="mt-2 max-w-md text-center text-sm text-gray-500 dark:text-gray-400">
        {isNetworkError
          ? "Please check your internet connection and try again."
          : "This paper may have been made private, deleted, or there was an error loading it."}
      </p>
      <div className="mt-4 flex gap-3">
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Try Again
        </button>
        <Link
          to="/"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-normal text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
        >
          Go to Carrel
        </Link>
      </div>
    </div>
  );
}

function SharePage() {
  const { slug } = Route.useParams();
  const { data: paper } = useSuspenseQuery(
    convexQuery(api.papers.getByShareSlug, { slug })
  );

  if (paper === null) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-lg font-normal text-gray-900 dark:text-gray-100">Paper not found</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          This paper may have been made private or deleted.
        </p>
        <Link to="/" className="mt-4 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
          Go to Carrel
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* PDF Viewer */}
      <div className="mb-6 h-[70vh] w-full overflow-hidden rounded-lg border bg-gray-100 shadow-lg dark:border-gray-800 dark:bg-gray-800">
        {paper.pdfUrl ? (
          <PdfViewer url={paper.pdfUrl} title={paper.title} />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400">
            <div className="text-center">
              <svg
                className="mx-auto h-16 w-16"
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
              <p className="mt-2 text-sm">PDF not available</p>
            </div>
          </div>
        )}
      </div>

      {/* Paper Info */}
      <div className="text-center">
        <h1 className="text-2xl font-normal text-gray-900 dark:text-gray-100">{paper.title}</h1>
        {paper.authors && paper.authors.length > 0 && (
          <p className="mt-1 text-gray-600 dark:text-gray-400">by {paper.authors.join(", ")}</p>
        )}
        {paper.pdfUrl && (
          <div className="mt-4">
            <a
              href={paper.pdfUrl}
              download
              className="inline-flex items-center rounded-md border border-primary-200 bg-primary-50 px-6 py-2 text-sm font-normal text-gray-900 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-primary-700 dark:bg-primary-500/20 dark:text-gray-100 dark:hover:bg-primary-500/30"
            >
              <svg
                className="mr-2 h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Download PDF
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-12 border-t pt-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        Shared via{" "}
        <Link to="/" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
          Carrel
        </Link>{" "}
        | Create your own carrel
      </div>
    </div>
  );
}

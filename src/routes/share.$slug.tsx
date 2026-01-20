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
});

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
        {paper.abstract && (
          <p className="mx-auto mt-4 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            {paper.abstract}
          </p>
        )}
        {paper.pdfUrl && (
          <div className="mt-4">
            <a
              href={paper.pdfUrl}
              download
              className="inline-flex items-center rounded-md bg-blue-600 px-6 py-2 text-sm font-normal text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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

import { Link } from "@tanstack/react-router";
import type { RefObject, KeyboardEvent } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { PaperStatusIndicator } from "./PaperStatusIndicator";
import { getRepoWebUrl } from "../lib/providers";

interface Repository {
  _id: Id<"repositories">;
  name: string;
  gitUrl: string;
  provider: string;
  lastSyncedAt?: number;
  lastCommitTime?: number;
  syncStatus?: string;
}

interface Paper {
  _id: Id<"papers">;
  title: string;
  authors?: string[];
  thumbnailUrl: string | null;
  pdfUrl: string | null;
  isUpToDate: boolean | null;
  pdfSourceType: string | null;
  buildStatus?: string;
  compilationProgress?: string;
  lastSyncError?: string | null;
  isPublic?: boolean;
  repository: Repository | null;
  lastAffectedCommitTime?: number;
  _creationTime: number;
}

interface PaperCardProps {
  paper: Paper;
  isEditing: boolean;
  editTitle: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onEditTitleChange: (value: string) => void;
  onSaveTitle: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onStartEdit: (e: React.MouseEvent, paperId: Id<"papers">, title: string) => void;
  onDeleteClick: (e: React.MouseEvent, paperId: Id<"papers">) => void;
  onFullscreen: (e: React.MouseEvent, pdfUrl: string, title: string) => void;
}

export function PaperCard({
  paper,
  isEditing,
  editTitle,
  inputRef,
  onEditTitleChange,
  onSaveTitle,
  onKeyDown,
  onStartEdit,
  onDeleteClick,
  onFullscreen,
}: PaperCardProps) {
  const cardClassName =
    "group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition-all duration-200 hover:border-gray-200 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700";

  const cardContent = (
    <>
      {/* Thumbnail */}
      <div className="relative aspect-[8.5/11] w-full bg-gray-100 dark:bg-gray-800">
        {paper.thumbnailUrl ? (
          <img
            src={paper.thumbnailUrl}
            alt={paper.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover dark:invert dark:hue-rotate-180"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400">
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
        )}
        {/* Fullscreen button overlay */}
        {paper.pdfUrl && (
          <button
            onClick={(e) => onFullscreen(e, paper.pdfUrl!, paper.title)}
            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100 focus:opacity-100"
            title="View PDF fullscreen (F)"
            aria-label={`View ${paper.title} PDF fullscreen`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex min-w-0 items-start gap-1">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editTitle}
              maxLength={200}
              onChange={(e) => onEditTitleChange(e.target.value)}
              onBlur={onSaveTitle}
              onKeyDown={onKeyDown}
              className="min-w-0 flex-1 truncate rounded border border-blue-400 px-1 py-0.5 text-sm font-normal text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
            />
          ) : (
            <>
              <h3 className="min-w-0 flex-1 truncate font-serif font-normal text-gray-900 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
                {paper.title}
              </h3>
              <button
                onClick={(e) => onStartEdit(e, paper._id, paper.title)}
                className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                title="Rename"
                aria-label={`Rename ${paper.title}`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
              <button
                onClick={(e) => onDeleteClick(e, paper._id)}
                className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 dark:hover:bg-red-900/30"
                title="Delete this paper permanently"
                aria-label={`Delete ${paper.title}`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </>
          )}
        </div>
        {paper.authors && paper.authors.length > 0 && (
          <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
            {paper.authors.join(", ")}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
          {paper.repository ? (
            <span className="flex items-center gap-1 truncate">
              {(() => {
                const webUrl = getRepoWebUrl(paper.repository.gitUrl, paper.repository.provider);
                return webUrl ? (
                  <a
                    href={webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="truncate hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                    title={`Open ${paper.repository.name} on ${paper.repository.provider}`}
                  >
                    {paper.repository.name}
                  </a>
                ) : (
                  <span className="truncate">{paper.repository.name}</span>
                );
              })()}
              <PaperStatusIndicator
                buildStatus={paper.buildStatus}
                pdfSourceType={paper.pdfSourceType}
                compilationProgress={paper.compilationProgress}
                isUpToDate={paper.isUpToDate}
                lastSyncError={paper.lastSyncError}
                repository={paper.repository}
                lastAffectedCommitTime={paper.lastAffectedCommitTime}
                creationTime={paper._creationTime}
              />
            </span>
          ) : (
            <span className="text-gray-400">Uploaded</span>
          )}
          <span className="flex items-center">
            {paper.isPublic ? (
              <span className="flex items-center text-green-600">
                <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
                Public
              </span>
            ) : paper.repository ? (
              <span className="flex items-center">
                <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                Private
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </>
  );

  return isEditing ? (
    <div className={cardClassName}>{cardContent}</div>
  ) : (
    <Link to="/papers/$id" params={{ id: paper._id }} className={cardClassName}>
      {cardContent}
    </Link>
  );
}

import { useState, useCallback, type ReactNode, type DragEvent } from "react";

interface RejectedFile {
  file: File;
  reason: string;
}

interface DropZoneProps {
  children: ReactNode;
  onDrop: (files: File[]) => void;
  onReject?: (rejectedFiles: RejectedFile[]) => void;
  accept?: string;
  className?: string;
}

export function DropZone({
  children,
  onDrop,
  onReject,
  accept = ".pdf",
  className = "",
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragOver to false if we're leaving the drop zone entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      const acceptedExtensions = accept.split(",").map((ext) => ext.trim().toLowerCase());

      const validFiles: File[] = [];
      const rejectedFiles: RejectedFile[] = [];

      files.forEach((file) => {
        const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
        if (acceptedExtensions.includes(extension) || acceptedExtensions.includes("*")) {
          validFiles.push(file);
        } else {
          rejectedFiles.push({
            file,
            reason: `File type not accepted. Expected: ${accept}`,
          });
        }
      });

      if (validFiles.length > 0) {
        onDrop(validFiles);
      }

      if (rejectedFiles.length > 0 && onReject) {
        onReject(rejectedFiles);
      }
    },
    [accept, onDrop, onReject]
  );

  return (
    <div
      className={`relative ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}

      {/* Drop overlay */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-4 border-dashed border-blue-500 bg-blue-50/90 dark:bg-blue-950/90">
          <div className="text-center">
            <svg
              className="mx-auto h-12 w-12 text-blue-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            <p className="mt-2 text-lg font-normal text-blue-700 dark:text-blue-300">
              Drop PDF to upload
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import type { RepoFile, SelectedFile } from "./types";
import type { Id } from "../../../convex/_generated/dataModel";

interface ConfigureRepositoryModalProps {
  repo: {
    _id: Id<"repositories">;
    name: string;
    gitUrl: string;
    defaultBranch: string;
  };
  onClose: () => void;
  onAddFiles: (files: SelectedFile[]) => Promise<void>;
  listRepositoryFiles: (args: { gitUrl: string; path: string; branch: string }) => Promise<RepoFile[]>;
}

export function ConfigureRepositoryModal({
  repo,
  onClose,
  onAddFiles,
  listRepositoryFiles,
}: ConfigureRepositoryModalProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [repoFiles, setRepoFiles] = useState<RepoFile[] | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [isAddingFiles, setIsAddingFiles] = useState(false);

  const loadFiles = useCallback(async (path: string) => {
    setIsLoadingFiles(true);
    try {
      const files = await listRepositoryFiles({
        gitUrl: repo.gitUrl,
        path,
        branch: repo.defaultBranch,
      });
      setRepoFiles(files);
      setCurrentPath(path);
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [listRepositoryFiles, repo.gitUrl, repo.defaultBranch]);

  useEffect(() => {
    loadFiles("");
  }, [loadFiles]);

  const navigateToFolder = (path: string) => {
    loadFiles(path);
  };

  const navigateUp = () => {
    const parentPath = currentPath.split("/").slice(0, -1).join("/");
    loadFiles(parentPath);
  };

  const toggleFileSelection = (file: { path: string; name: string }) => {
    const isSelected = selectedFiles.some((f) => f.path === file.path);
    if (isSelected) {
      setSelectedFiles(selectedFiles.filter((f) => f.path !== file.path));
    } else {
      const title = file.name.replace(/\.(tex|pdf)$/, "");
      const pdfSourceType = file.name.endsWith(".pdf") ? "committed" : "compile";
      setSelectedFiles([...selectedFiles, { path: file.path, title, pdfSourceType }]);
    }
  };

  const updateFileTitle = (path: string, title: string) => {
    setSelectedFiles(
      selectedFiles.map((f) => (f.path === path ? { ...f, title } : f))
    );
  };

  const handleAddFiles = async () => {
    if (selectedFiles.length === 0) return;
    setIsAddingFiles(true);
    try {
      await onAddFiles(selectedFiles);
      onClose();
    } catch (error) {
      console.error("Failed to add files:", error);
    } finally {
      setIsAddingFiles(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-normal text-gray-900 dark:text-gray-100">Configure Papers</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{repo.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* File Browser */}
          <div className="flex w-1/2 flex-col border-r dark:border-gray-700">
            <div className="border-b bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <button onClick={() => navigateToFolder("")} className="hover:text-blue-600 dark:hover:text-blue-400">
                  {repo.name}
                </button>
                {currentPath && (
                  <>
                    {currentPath.split("/").map((part, i, arr) => (
                      <span key={i} className="flex items-center gap-2">
                        <span>/</span>
                        <button
                          onClick={() => navigateToFolder(arr.slice(0, i + 1).join("/"))}
                          className="hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          {part}
                        </button>
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {isLoadingFiles ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              ) : (
                <div className="space-y-1">
                  {currentPath && (
                    <button
                      onClick={navigateUp}
                      className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                      </svg>
                      <span className="text-gray-500 dark:text-gray-400">..</span>
                    </button>
                  )}
                  {repoFiles?.map((file) => (
                    <FileItem
                      key={file.path}
                      file={file}
                      isSelected={selectedFiles.some((f) => f.path === file.path)}
                      onNavigate={navigateToFolder}
                      onToggle={toggleFileSelection}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Selected Files */}
          <div className="flex w-1/2 flex-col">
            <div className="border-b bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="text-sm font-normal text-gray-700 dark:text-gray-300">
                Selected Files ({selectedFiles.length})
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {selectedFiles.length === 0 ? (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                  Select .tex or .pdf files from the file browser to track them as papers.
                </p>
              ) : (
                <div className="space-y-4">
                  {selectedFiles.map((file) => (
                    <div key={file.path} className="rounded-lg border p-3 dark:border-gray-700">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{file.path}</span>
                        <button
                          onClick={() => toggleFileSelection({ path: file.path, name: file.path.split("/").pop() || "" })}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={file.title}
                        onChange={(e) => updateFileTitle(file.path, e.target.value)}
                        placeholder="Paper title"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                      />
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {file.pdfSourceType === "compile" ? (
                          <span className="text-green-600 dark:text-green-400">Will be compiled from LaTeX</span>
                        ) : (
                          <span className="text-blue-600 dark:text-blue-400">PDF from repository</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t p-4 dark:border-gray-700">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleAddFiles}
            disabled={selectedFiles.length === 0 || isAddingFiles}
            className="rounded-md border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-normal text-gray-900 dark:text-gray-100 hover:bg-primary-100 disabled:opacity-50"
          >
            {isAddingFiles ? "Adding..." : `Add ${selectedFiles.length} Paper${selectedFiles.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function FileItem({
  file,
  isSelected,
  onNavigate,
  onToggle,
}: {
  file: RepoFile;
  isSelected: boolean;
  onNavigate: (path: string) => void;
  onToggle: (file: { path: string; name: string }) => void;
}) {
  const isTexOrPdf = file.name.endsWith(".tex") || file.name.endsWith(".pdf");

  if (file.type === "dir") {
    return (
      <button
        onClick={() => onNavigate(file.path)}
        className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        {file.name}
      </button>
    );
  }

  return (
    <button
      onClick={() => isTexOrPdf && onToggle(file)}
      disabled={!isTexOrPdf}
      className={`flex w-full items-center gap-2 rounded p-2 text-left text-sm ${
        isTexOrPdf
          ? isSelected
            ? "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300"
            : "hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          : "cursor-not-allowed text-gray-400 dark:text-gray-500"
      }`}
    >
      {isTexOrPdf && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 dark:border-gray-600 dark:bg-gray-700"
        />
      )}
      <svg className={`h-4 w-4 ${isTexOrPdf ? "text-gray-500 dark:text-gray-400" : "text-gray-300 dark:text-gray-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span>{file.name}</span>
      {file.name.endsWith(".tex") && (
        <span className="ml-auto rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">LaTeX</span>
      )}
      {file.name.endsWith(".pdf") && (
        <span className="ml-auto rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">PDF</span>
      )}
    </button>
  );
}

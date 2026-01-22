/**
 * Shared types for Git provider abstraction layer.
 */

/**
 * Error thrown when a file is not found in the repository.
 * This indicates the file was deleted or renamed.
 */
export class FileNotFoundError extends Error {
  constructor(filePath: string, provider: string) {
    super(`File not found in repository: ${filePath}`);
    this.name = "FileNotFoundError";
    this.filePath = filePath;
    this.provider = provider;
  }

  readonly filePath: string;
  readonly provider: string;
}

/**
 * Check if an error is a FileNotFoundError.
 */
export function isFileNotFoundError(error: unknown): error is FileNotFoundError {
  return error instanceof Error && error.name === "FileNotFoundError";
}

/**
 * Information about a commit.
 */
export interface CommitInfo {
  sha: string;
  message: string;
  date?: string;
  /** If true, the SHA matches the known SHA (Overleaf optimization). */
  unchanged?: boolean;
}

/**
 * Information about a repository.
 */
export interface RepositoryInfo {
  name: string;
  fullName?: string;
  defaultBranch: string;
  description?: string;
  isPrivate: boolean;
}

/**
 * A file or directory entry in a repository.
 */
export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

/**
 * File content result with byte array and size.
 */
export interface FileContentResult {
  content: number[];
  size: number;
}

/**
 * Result of storing a file to Convex storage.
 */
export interface StoredFileResult {
  storageId: string;
  size: number;
}

/**
 * Git provider interface that all providers must implement.
 */
export interface GitProvider {
  /** Human-readable provider name (e.g., "github", "gitlab", "gitlab:myinstance"). */
  readonly providerName: string;
  /** Base URL for API requests. */
  readonly baseUrl: string;

  /**
   * Fetch basic information about a repository.
   */
  fetchRepositoryInfo(owner: string, repo: string): Promise<RepositoryInfo>;

  /**
   * Fetch the latest commit on a branch.
   * @param knownSha - Optional SHA to compare against (for Overleaf "unchanged" optimization).
   */
  fetchLatestCommit(
    owner: string,
    repo: string,
    branch: string,
    knownSha?: string
  ): Promise<CommitInfo>;

  /**
   * Fetch raw file content as bytes.
   */
  fetchFileContent(
    owner: string,
    repo: string,
    branch: string,
    filePath: string
  ): Promise<ArrayBuffer>;

  /**
   * List files in a directory.
   * @param path - Optional path within the repository (default: root).
   */
  listFiles(
    owner: string,
    repo: string,
    branch: string,
    path?: string
  ): Promise<FileEntry[]>;

  /**
   * Get list of files changed between two commits.
   * Returns empty array if not supported or on error.
   */
  fetchChangedFiles(
    owner: string,
    repo: string,
    baseCommit: string,
    headCommit: string
  ): Promise<string[]>;

  /**
   * Fetch the git blob hash for a single file.
   */
  fetchFileHash(
    owner: string,
    repo: string,
    branch: string,
    filePath: string
  ): Promise<string | null>;

  /**
   * Fetch git blob hashes for multiple files in batch.
   */
  fetchFileHashBatch(
    owner: string,
    repo: string,
    branch: string,
    filePaths: string[]
  ): Promise<Record<string, string | null>>;
}

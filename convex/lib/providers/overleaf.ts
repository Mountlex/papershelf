/**
 * Overleaf provider implementation.
 * All operations are delegated to the latex-service microservice.
 */

import type {
  GitProvider,
  CommitInfo,
  RepositoryInfo,
  FileEntry,
} from "./types";
import { FileNotFoundError } from "./types";
import { fetchWithTimeout } from "../http";
import { getLatexServiceHeaders } from "../http";

// Overleaf operations use longer timeouts since they involve git operations
const OVERLEAF_REFS_TIMEOUT = 30000; // 30 seconds for refs
const OVERLEAF_TREE_TIMEOUT = 60000; // 1 minute for tree
const OVERLEAF_FILE_TIMEOUT = 60000; // 1 minute for file content
const OVERLEAF_HASH_TIMEOUT = 60000; // 1 minute for hash batch

export class OverleafProvider implements GitProvider {
  readonly providerName = "overleaf";
  readonly baseUrl: string;

  constructor(
    private gitUrl: string,
    private auth: { username: string; password: string },
    private latexServiceUrl: string
  ) {
    this.baseUrl = latexServiceUrl;
  }

  private async post(
    endpoint: string,
    body: object,
    timeout: number
  ): Promise<Response> {
    return fetchWithTimeout(`${this.latexServiceUrl}${endpoint}`, {
      method: "POST",
      headers: getLatexServiceHeaders(),
      body: JSON.stringify({
        gitUrl: this.gitUrl,
        auth: this.auth,
        ...body,
      }),
      timeout,
    });
  }

  async fetchRepositoryInfo(): Promise<RepositoryInfo> {
    // Use refs endpoint to get basic info
    const response = await this.post("/git/refs", {}, OVERLEAF_REFS_TIMEOUT);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to access Overleaf project: ${error}`);
    }

    const data = await response.json();
    // Extract project ID from gitUrl for the name
    const projectId = this.gitUrl.split("/").pop() || "unknown";

    return {
      name: `Overleaf Project ${projectId.substring(0, 8)}`,
      defaultBranch: data.defaultBranch || "master",
      isPrivate: true,
    };
  }

  async fetchLatestCommit(
    _owner: string,
    _repo: string,
    branch: string,
    knownSha?: string
  ): Promise<CommitInfo> {
    const response = await this.post(
      "/git/refs",
      { branch, knownSha },
      OVERLEAF_REFS_TIMEOUT
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get Overleaf commit: ${error}`);
    }

    const data = await response.json();

    // If SHA unchanged, return with unchanged flag (caller should use cached date)
    if (data.unchanged) {
      return {
        sha: data.sha,
        message: "Overleaf commit",
        unchanged: true,
      };
    }

    return {
      sha: data.sha,
      message: data.message || "Overleaf commit",
      date: data.date || new Date().toISOString(),
    };
  }

  async fetchFileContent(
    _owner: string,
    _repo: string,
    branch: string,
    filePath: string
  ): Promise<ArrayBuffer> {
    const response = await this.post(
      "/git/file",
      { filePath, branch },
      OVERLEAF_FILE_TIMEOUT
    );

    if (!response.ok) {
      const error = await response.text();
      // Check for file not found error
      if (response.status === 404 || error.includes("File not found") || error.includes("not found")) {
        throw new FileNotFoundError(filePath, "overleaf");
      }
      throw new Error(`Failed to fetch file from Overleaf: ${error}`);
    }

    const data = await response.json();

    if (data.encoding === "base64") {
      const binaryString = atob(data.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    // Text file - convert to bytes
    const encoder = new TextEncoder();
    return encoder.encode(data.content).buffer;
  }

  async listFiles(
    _owner: string,
    _repo: string,
    branch: string,
    path?: string
  ): Promise<FileEntry[]> {
    const response = await this.post(
      "/git/tree",
      { path: path || "", branch },
      OVERLEAF_TREE_TIMEOUT
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list Overleaf files: ${error}`);
    }

    const data = await response.json();
    return data.files as FileEntry[];
  }

  async fetchChangedFiles(): Promise<string[]> {
    // Overleaf doesn't support compare API - return empty to trigger full check
    return [];
  }

  async fetchFileHash(
    _owner: string,
    _repo: string,
    branch: string,
    filePath: string
  ): Promise<string | null> {
    // Use the batch endpoint for a single file
    const result = await this.fetchFileHashBatch("", "", branch, [filePath]);
    return result[filePath] ?? null;
  }

  async fetchFileHashBatch(
    _owner: string,
    _repo: string,
    branch: string,
    filePaths: string[]
  ): Promise<Record<string, string | null>> {
    if (filePaths.length === 0) {
      return {};
    }

    const response = await this.post(
      "/git/file-hash",
      { filePaths, branch },
      OVERLEAF_HASH_TIMEOUT
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get file hashes from Overleaf: ${error}`);
    }

    const data = await response.json();
    return data.hashes as Record<string, string | null>;
  }
}

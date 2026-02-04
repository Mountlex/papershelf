/**
 * GitHub provider implementation.
 */

import type {
  GitProvider,
  CommitInfo,
  RepositoryInfo,
  FileEntry,
} from "./types";
import { FileNotFoundError } from "./types";
import {
  buildGitHubHeaders,
  parseGitHubCommit,
  parseGitHubRepoInfo,
  interpretGitHubError,
  safeJsonParse,
} from "./gitHelpers";
import { fetchWithTimeout, withTimeout, BATCH_OPERATION_TIMEOUT } from "../http";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

export class GitHubProvider implements GitProvider {
  readonly providerName = "github";
  readonly baseUrl = GITHUB_API_BASE;

  constructor(private token: string | null) {}

  private headers(): Record<string, string> {
    return buildGitHubHeaders(this.token);
  }

  async fetchRepositoryInfo(owner: string, repo: string): Promise<RepositoryInfo> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/repos/${owner}/${repo}`,
      { headers: this.headers() }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(interpretGitHubError(response.status, owner, repo, !!this.token));
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await safeJsonParse(response, "GitHub repository info");
    return parseGitHubRepoInfo(data);
  }

  async fetchLatestCommit(
    owner: string,
    repo: string,
    branch: string,
    knownSha?: string
  ): Promise<CommitInfo> {
    // Quick SHA check if we have a known SHA - uses lightweight refs endpoint
    if (knownSha) {
      const refResponse = await fetchWithTimeout(
        `${this.baseUrl}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
        { headers: this.headers() }
      );
      if (refResponse.ok) {
        const refData = await safeJsonParse(refResponse, "GitHub ref info") as {
          object?: { sha?: string };
        };
        if (refData.object?.sha === knownSha) {
          return { sha: knownSha, message: "", unchanged: true };
        }
      }
      // Fall through to full commit fetch if ref check fails or SHA differs
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}/repos/${owner}/${repo}/commits/${branch}`,
      { headers: this.headers() }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new Error(interpretGitHubError(response.status, owner, repo, !!this.token));
      }
      throw new Error("Failed to access repository. Please try again later.");
    }

    const data = await safeJsonParse(response, "GitHub commit info");
    return parseGitHubCommit(data);
  }

  async fetchFileContent(
    owner: string,
    repo: string,
    branch: string,
    filePath: string
  ): Promise<ArrayBuffer> {
    const headers: Record<string, string> = {
      "User-Agent": "Carrel",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const rawUrl = `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${filePath}`;
    const response = await fetchWithTimeout(rawUrl, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        throw new FileNotFoundError(filePath, "github");
      }
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  async listFiles(
    owner: string,
    repo: string,
    branch: string,
    path?: string
  ): Promise<FileEntry[]> {
    const pathSegment = path || "";
    const response = await fetchWithTimeout(
      `${this.baseUrl}/repos/${owner}/${repo}/contents/${pathSegment}?ref=${branch}`,
      { headers: this.headers() }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();
    // If it's a single file, wrap in array
    const files = Array.isArray(data) ? data : [data];

    return files.map(
      (file: { name: string; path: string; type: string; size?: number }) => ({
        name: file.name,
        path: file.path,
        type: file.type as "file" | "dir",
        size: file.size,
      })
    );
  }

  async fetchChangedFiles(
    owner: string,
    repo: string,
    baseCommit: string,
    headCommit: string
  ): Promise<string[]> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/repos/${owner}/${repo}/compare/${baseCommit}...${headCommit}`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        console.log(`GitHub compare API failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const files = (data.files || []) as Array<{
        filename: string;
        previous_filename?: string;
      }>;

      if (typeof data.total_files === "number" && data.total_files > files.length) {
        console.log(`GitHub compare results truncated (${files.length}/${data.total_files}); falling back to full checks`);
        return [];
      }

      const paths: string[] = [];
      for (const file of files) {
        if (file.filename) {
          paths.push(file.filename);
        }
        if (file.previous_filename) {
          paths.push(file.previous_filename);
        }
      }
      return Array.from(new Set(paths));
    } catch (error) {
      console.log(`Failed to fetch changed files: ${error}`);
      return [];
    }
  }

  async fetchFileHash(
    owner: string,
    repo: string,
    branch: string,
    filePath: string
  ): Promise<string | null> {
    try {
      const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
      const response = await fetchWithTimeout(
        `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.sha as string;
    } catch {
      return null;
    }
  }

  async fetchFileHashBatch(
    owner: string,
    repo: string,
    branch: string,
    filePaths: string[]
  ): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {};

    const fetchPromises = filePaths.map(async (filePath) => {
      try {
        const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
        const response = await fetchWithTimeout(
          `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
          { headers: this.headers() }
        );
        if (!response.ok) {
          return { path: filePath, hash: null };
        }
        const data = await response.json();
        return { path: filePath, hash: data.sha as string };
      } catch {
        return { path: filePath, hash: null };
      }
    });

    const fetchResults = await withTimeout(
      Promise.all(fetchPromises),
      BATCH_OPERATION_TIMEOUT,
      `Batch hash fetch timed out after ${BATCH_OPERATION_TIMEOUT}ms for ${filePaths.length} files`
    );

    for (const result of fetchResults) {
      results[result.path] = result.hash;
    }

    return results;
  }
}

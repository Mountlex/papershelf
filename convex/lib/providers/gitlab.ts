/**
 * GitLab provider implementation.
 * Handles both GitLab.com (cloud) and self-hosted GitLab instances.
 */

import type {
  GitProvider,
  CommitInfo,
  RepositoryInfo,
  FileEntry,
} from "./types";
import { FileNotFoundError, GitLabApiError } from "./types";
import {
  buildGitLabHeaders,
  parseGitLabCommit,
  parseGitLabRepoInfo,
  interpretGitLabError,
  safeJsonParse,
} from "./gitHelpers";
import { fetchWithTimeout, withTimeout, BATCH_OPERATION_TIMEOUT } from "../http";

export class GitLabProvider implements GitProvider {
  readonly providerName: string;
  readonly baseUrl: string;
  private token: string;
  private instanceName?: string;

  constructor(
    token: string,
    baseUrl: string = "https://gitlab.com",
    instanceName?: string
  ) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.instanceName = instanceName;
    this.providerName = instanceName ? `gitlab:${instanceName}` : "gitlab";
  }

  private headers(): Record<string, string> {
    return buildGitLabHeaders(this.token);
  }

  private projectId(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  async fetchRepositoryInfo(owner: string, repo: string): Promise<RepositoryInfo> {
    const pid = this.projectId(owner, repo);
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/v4/projects/${pid}`,
      { headers: this.headers() }
    );

    if (!response.ok) {
      throw new GitLabApiError(
        response.status,
        interpretGitLabError(response.status, owner, repo, this.instanceName, !!this.token),
        this.providerName,
        this.instanceName
      );
    }

    const data = await safeJsonParse(response, "GitLab repository info");
    const info = parseGitLabRepoInfo(data);
    return {
      ...info,
      description: info.description ?? undefined,
    };
  }

  async fetchLatestCommit(
    owner: string,
    repo: string,
    branch: string,
    knownSha?: string
  ): Promise<CommitInfo> {
    const pid = this.projectId(owner, repo);

    // Quick SHA check if we have a known SHA - uses branches endpoint which returns commit SHA
    if (knownSha) {
      const branchResponse = await fetchWithTimeout(
        `${this.baseUrl}/api/v4/projects/${pid}/repository/branches/${encodeURIComponent(branch)}`,
        { headers: this.headers() }
      );
      if (branchResponse.ok) {
        const branchData = await safeJsonParse(branchResponse, "GitLab branch info") as {
          commit?: { id?: string };
        };
        if (branchData.commit?.id === knownSha) {
          return { sha: knownSha, message: "", unchanged: true };
        }
      }
      // Fall through to full commit fetch if branch check fails or SHA differs
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/v4/projects/${pid}/repository/commits/${encodeURIComponent(branch)}`,
      { headers: this.headers() }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new GitLabApiError(
          response.status,
          interpretGitLabError(response.status, owner, repo, this.instanceName, !!this.token),
          this.providerName,
          this.instanceName
        );
      }
      throw new GitLabApiError(
        response.status,
        "Failed to access repository. Please try again later.",
        this.providerName,
        this.instanceName
      );
    }

    const data = await safeJsonParse(response, "GitLab commit info");
    return parseGitLabCommit(data);
  }

  async fetchFileContent(
    owner: string,
    repo: string,
    branch: string,
    filePath: string
  ): Promise<ArrayBuffer> {
    const pid = this.projectId(owner, repo);
    const encodedFilePath = encodeURIComponent(filePath);

    const headers: Record<string, string> = {
      "User-Agent": "Carrel",
    };
    if (this.token) {
      headers["PRIVATE-TOKEN"] = this.token;
    }

    const rawUrl = `${this.baseUrl}/api/v4/projects/${pid}/repository/files/${encodedFilePath}/raw?ref=${branch}`;
    const response = await fetchWithTimeout(rawUrl, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        throw new FileNotFoundError(filePath, "gitlab");
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
    const pid = this.projectId(owner, repo);
    const allFiles: FileEntry[] = [];
    const perPage = 100;
    let page = 1;

    // Paginate through all results
    while (true) {
      const params = new URLSearchParams({
        ref: branch,
        per_page: String(perPage),
        page: String(page),
      });
      if (path) {
        params.set("path", path);
      }

      const response = await fetchWithTimeout(
        `${this.baseUrl}/api/v4/projects/${pid}/repository/tree?${params}`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        throw new Error(`GitLab API error: ${response.statusText}`);
      }

      const data = await response.json();

      const files = data.map((file: { name: string; path: string; type: string }) => ({
        name: file.name,
        path: file.path,
        type: file.type === "tree" ? "dir" : "file",
        size: undefined, // GitLab tree endpoint doesn't return size
      }));

      allFiles.push(...files);

      // If we got fewer items than requested, we've reached the end
      if (data.length < perPage) {
        break;
      }
      page++;
    }

    return allFiles;
  }

  async fetchChangedFiles(
    owner: string,
    repo: string,
    baseCommit: string,
    headCommit: string
  ): Promise<string[]> {
    try {
      const pid = this.projectId(owner, repo);
      const response = await fetchWithTimeout(
        `${this.baseUrl}/api/v4/projects/${pid}/repository/compare?from=${baseCommit}&to=${headCommit}`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        console.log(`GitLab compare API failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const diffs = (data.diffs || []) as Array<{ new_path?: string; old_path?: string }>;
      const paths: string[] = [];
      for (const diff of diffs) {
        if (diff.new_path) {
          paths.push(diff.new_path);
        }
        if (diff.old_path) {
          paths.push(diff.old_path);
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
      const pid = this.projectId(owner, repo);
      const encodedFilePath = encodeURIComponent(filePath);
      const response = await fetchWithTimeout(
        `${this.baseUrl}/api/v4/projects/${pid}/repository/files/${encodedFilePath}?ref=${encodeURIComponent(branch)}`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.blob_id as string;
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
    const pid = this.projectId(owner, repo);

    const fetchPromises = filePaths.map(async (filePath) => {
      try {
        const encodedFilePath = encodeURIComponent(filePath);
        const response = await fetchWithTimeout(
          `${this.baseUrl}/api/v4/projects/${pid}/repository/files/${encodedFilePath}?ref=${encodeURIComponent(branch)}`,
          { headers: this.headers() }
        );
        if (!response.ok) {
          return { path: filePath, hash: null };
        }
        const data = await response.json();
        return { path: filePath, hash: data.blob_id as string };
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

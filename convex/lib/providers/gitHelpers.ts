/**
 * Helper functions for Git provider implementations.
 */

import type { ParsedRepoUrl, SelfHostedGitLabInstance } from "../gitProviders";

/**
 * Result of resolving a GitLab instance (cloud or self-hosted).
 */
export interface GitLabResolution {
  baseUrl: string;
  token: string;
  instanceName?: string;
}

/**
 * Resolve GitLab instance details from parsed URL and available instances.
 * Handles both cloud GitLab and self-hosted instances.
 */
export function resolveGitLabInstance(
  parsed: ParsedRepoUrl,
  selfHostedInstances: SelfHostedGitLabInstance[],
  cloudToken: string | null
): GitLabResolution {
  if (parsed.provider === "selfhosted-gitlab") {
    const instance = selfHostedInstances.find(
      (i) => i.url === parsed.matchedInstanceUrl
    );
    if (!instance) {
      throw new Error(
        `Self-hosted GitLab instance not found for URL: ${parsed.matchedInstanceUrl}. ` +
          `The instance may have been deleted. Please re-add the repository.`
      );
    }
    return {
      baseUrl: instance.url,
      token: instance.token,
      instanceName: instance.name,
    };
  }
  return {
    baseUrl: "https://gitlab.com",
    token: cloudToken ?? "",
  };
}

/**
 * Build headers for GitHub API requests.
 */
export function buildGitHubHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Carrel",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Build headers for GitLab API requests.
 */
export function buildGitLabHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Carrel",
  };
  if (token) {
    headers["PRIVATE-TOKEN"] = token;
  }
  return headers;
}

/**
 * Parse GitHub commit response to normalized format.
 */
export function parseGitHubCommit(data: unknown): {
  sha: string;
  message: string;
  date: string;
} {
  const d = data as {
    sha: string;
    commit: { message: string; committer: { date: string } };
  };
  return {
    sha: d.sha,
    message: d.commit.message,
    date: d.commit.committer.date,
  };
}

/**
 * Parse GitLab commit response to normalized format.
 */
export function parseGitLabCommit(data: unknown): {
  sha: string;
  message: string;
  date: string;
} {
  const d = data as { id: string; message: string; committed_date: string };
  return {
    sha: d.id,
    message: d.message,
    date: d.committed_date,
  };
}

/**
 * Parse GitHub repository info response.
 */
export function parseGitHubRepoInfo(data: unknown): {
  name: string;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  isPrivate: boolean;
} {
  const d = data as {
    name: string;
    full_name: string;
    default_branch: string;
    description: string | null;
    private: boolean;
  };
  return {
    name: d.name,
    fullName: d.full_name,
    defaultBranch: d.default_branch,
    description: d.description,
    isPrivate: d.private,
  };
}

/**
 * Parse GitLab repository info response.
 */
export function parseGitLabRepoInfo(data: unknown): {
  name: string;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  isPrivate: boolean;
} {
  const d = data as {
    name: string;
    path_with_namespace: string;
    default_branch: string;
    description: string | null;
    visibility: string;
  };
  return {
    name: d.name,
    fullName: d.path_with_namespace,
    defaultBranch: d.default_branch,
    description: d.description,
    isPrivate: d.visibility !== "public",
  };
}

/**
 * Generate a helpful error message for GitLab API errors.
 */
export function interpretGitLabError(
  status: number,
  owner: string,
  repo: string,
  instanceName?: string,
  hasToken?: boolean
): string {
  const location = instanceName ? ` on ${instanceName}` : "";

  if (status === 401) {
    if (instanceName) {
      return (
        `Authentication failed for ${instanceName}. ` +
        "Your Personal Access Token may be expired or invalid. " +
        "Please update the token in your self-hosted GitLab settings."
      );
    }
    return "GitLab authentication failed. Please sign in with GitLab again.";
  }

  if (status === 403) {
    if (instanceName) {
      return (
        `Access denied to ${owner}/${repo}${location}. ` +
        "Your PAT may lack the required scopes (read_api, read_repository) or you may not have access to this project."
      );
    }
    return (
      `Access denied to ${owner}/${repo}. ` +
      "Check that you have permission to view this repository."
    );
  }

  if (status === 404) {
    if (instanceName) {
      return (
        `Repository not found: ${owner}/${repo}${location}. ` +
        "Check that the repository exists and your PAT has access to it."
      );
    }
    const privateNote = hasToken
      ? "Check that you have access to this repository."
      : "If this is a private repository, sign in with GitLab first.";
    return `Repository not found: ${owner}/${repo}. ${privateNote}`;
  }

  return `GitLab API error (HTTP ${status})${location}`;
}

/**
 * Generate a helpful error message for GitHub API errors.
 */
export function interpretGitHubError(
  status: number,
  owner: string,
  repo: string,
  hasToken?: boolean
): string {
  if (status === 401 || status === 403 || status === 404) {
    if (status === 404) {
      const privateNote = hasToken
        ? "Check that you have access to this repository."
        : "If this is a private repository, sign in with GitHub first.";
      return `Repository not found: ${owner}/${repo}. ${privateNote}`;
    }
    return "Repository not found or access denied. Make sure the repository exists and you have the correct permissions.";
  }
  return `GitHub API error (HTTP ${status})`;
}

/**
 * Safe JSON parsing helper to handle corrupted/HTML responses.
 */
export async function safeJsonParse<T>(
  response: Response,
  context: string
): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Log first 200 chars to help debug without exposing full response
    console.error(`JSON parse failed for ${context}: ${text.slice(0, 200)}`);
    throw new Error(`Invalid JSON response from ${context}`);
  }
}

/**
 * Type for parsed repo URL (re-exported for convenience).
 */
export type { ParsedRepoUrl, SelfHostedGitLabInstance } from "../gitProviders";

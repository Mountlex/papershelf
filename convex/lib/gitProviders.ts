import type { Id } from "../_generated/dataModel";

// Type for self-hosted GitLab instance
export type SelfHostedGitLabInstance = {
  _id: Id<"selfHostedGitLabInstances">;
  name: string;
  url: string;
  token: string;
};

// Parse GitHub URL to extract owner and repo
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

// Parse GitLab URL to extract owner and repo
// Supports nested groups like gitlab.com/group/subgroup/project
export function parseGitLabUrl(url: string): { owner: string; repo: string } | null {
  // Match gitlab.com URLs with any number of path segments
  // The owner (namespace) can be a user, group, or nested groups
  const match = url.match(/gitlab\.com[/:]((?:[\w-]+\/)+)([\w.-]+?)(\.git)?$/);
  if (match) {
    // match[1] is the namespace with trailing slash (e.g., "group/subgroup/")
    // match[2] is the repo name
    const owner = match[1].replace(/\/$/, ""); // Remove trailing slash
    return { owner, repo: match[2] };
  }
  return null;
}

// Parse Overleaf URL to extract project ID
// Supports both git URL (git.overleaf.com/abc123) and web URL (overleaf.com/project/abc123)
export function parseOverleafUrl(url: string): { projectId: string; gitUrl: string } | null {
  // Try git URL format: https://git.overleaf.com/<project_id>
  const gitMatch = url.match(/git\.overleaf\.com\/([a-f0-9]+)/i);
  if (gitMatch) {
    return { projectId: gitMatch[1], gitUrl: `https://git.overleaf.com/${gitMatch[1]}` };
  }
  // Try web URL format: https://www.overleaf.com/project/<project_id> or https://overleaf.com/project/<project_id>
  const webMatch = url.match(/(?:www\.)?overleaf\.com\/project\/([a-f0-9]+)/i);
  if (webMatch) {
    return { projectId: webMatch[1], gitUrl: `https://git.overleaf.com/${webMatch[1]}` };
  }
  return null;
}

// Parse self-hosted GitLab URL to extract owner and repo
// Supports nested groups like group/subgroup/project
export function parseSelfHostedGitLabUrl(url: string, instanceUrl: string): { owner: string; repo: string } | null {
  try {
    const instance = new URL(instanceUrl);
    const instanceHost = instance.host;
    // Match URLs like:
    //   https://gitlab.mycompany.com/owner/repo
    //   https://gitlab.mycompany.com/group/subgroup/repo
    //   https://gitlab.mycompany.com/group/subgroup/repo.git
    //   git@gitlab.mycompany.com:group/subgroup/repo.git
    // The owner (namespace) can contain multiple segments separated by /
    const regex = new RegExp(`${instanceHost.replace(/\./g, "\\.")}[/:]((?:[\\w.-]+/)+)([\\w.-]+?)(\\.git)?$`);
    const match = url.match(regex);
    if (match) {
      // match[1] is the namespace with trailing slash (e.g., "group/subgroup/")
      // match[2] is the repo name
      const owner = match[1].replace(/\/$/, ""); // Remove trailing slash
      return { owner, repo: match[2] };
    }
  } catch {
    // Invalid URL
  }
  return null;
}

// Check if URL matches a self-hosted GitLab instance
export function isSelfHostedGitLab(url: string, instanceUrl: string): boolean {
  try {
    const instance = new URL(instanceUrl);
    return url.includes(instance.host);
  } catch {
    return false;
  }
}

// Detect provider from URL (checks against all configured self-hosted instances)
export function getProviderFromUrl(
  url: string,
  selfHostedInstances: Array<{ url: string }> = []
): "github" | "gitlab" | "selfhosted-gitlab" | "overleaf" | null {
  if (url.includes("github.com")) return "github";
  if (url.includes("gitlab.com")) return "gitlab";
  // Check for Overleaf URLs (both git.overleaf.com and www.overleaf.com/project/)
  if (url.includes("git.overleaf.com") || url.includes("overleaf.com/project/")) return "overleaf";
  for (const instance of selfHostedInstances) {
    if (isSelfHostedGitLab(url, instance.url)) {
      return "selfhosted-gitlab";
    }
  }
  return null;
}

// Parse URL based on detected provider
export function parseRepoUrl(
  url: string,
  selfHostedInstances: Array<{ url: string }> = []
): { owner: string; repo: string; provider: "github" | "gitlab" | "selfhosted-gitlab"; matchedInstanceUrl?: string } | null {
  const provider = getProviderFromUrl(url, selfHostedInstances);
  if (provider === "github") {
    const parsed = parseGitHubUrl(url);
    if (parsed) return { ...parsed, provider };
  } else if (provider === "gitlab") {
    const parsed = parseGitLabUrl(url);
    if (parsed) return { ...parsed, provider };
  } else if (provider === "selfhosted-gitlab") {
    // Find the matching instance
    for (const instance of selfHostedInstances) {
      if (isSelfHostedGitLab(url, instance.url)) {
        const parsed = parseSelfHostedGitLabUrl(url, instance.url);
        if (parsed) return { ...parsed, provider, matchedInstanceUrl: instance.url };
      }
    }
  }
  return null;
}

/**
 * Creates headers for GitLab API requests.
 * @param token - Optional GitLab access token (PRIVATE-TOKEN)
 * @returns Headers object with User-Agent and optional PRIVATE-TOKEN
 */
export function getGitLabHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Carrel",
  };
  if (token) {
    headers["PRIVATE-TOKEN"] = token;
  }
  return headers;
}

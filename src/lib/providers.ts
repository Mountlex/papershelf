/**
 * Git provider utilities for URL conversion and display labels.
 */

/**
 * Convert git URL to web URL for the repository.
 * @param gitUrl - The git URL (e.g., git@github.com:owner/repo.git)
 * @param provider - The provider type
 * @returns Web URL or null if conversion fails
 */
export function getRepoWebUrl(gitUrl: string, provider: string): string | null {
  // Remove .git suffix if present
  const url = gitUrl.replace(/\.git$/, "");

  // GitHub: https://github.com/owner/repo
  if (provider === "github") {
    const match = url.match(/github\.com[/:]([\w-]+\/[\w.-]+)/);
    if (match) return `https://github.com/${match[1]}`;
  }

  // GitLab: https://gitlab.com/owner/repo
  if (provider === "gitlab") {
    const match = url.match(/gitlab\.com[/:]((?:[\w-]+\/)+[\w.-]+)/);
    if (match) return `https://gitlab.com/${match[1]}`;
  }

  // Overleaf: https://www.overleaf.com/project/<id>
  if (provider === "overleaf") {
    const match = url.match(/git\.overleaf\.com\/([a-f0-9]+)/i);
    if (match) return `https://www.overleaf.com/project/${match[1]}`;
  }

  // Self-hosted GitLab: convert git URL to web URL
  if (provider === "selfhosted-gitlab") {
    // Handle both https:// and git@ formats
    if (url.startsWith("git@")) {
      const match = url.match(/git@([^:]+):(.+)/);
      if (match) return `https://${match[1]}/${match[2]}`;
    }
    // Already https format
    return url;
  }

  return null;
}

/**
 * Provider display labels mapping.
 */
export const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  overleaf: "Overleaf",
  "selfhosted-gitlab": "Self-hosted GitLab",
};

/**
 * Get display label for a provider.
 * @param provider - The provider type
 * @returns Human-readable label
 */
export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

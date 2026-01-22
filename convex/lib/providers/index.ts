/**
 * Git provider factory and exports.
 *
 * This module provides a unified interface for working with different Git providers
 * (GitHub, GitLab, self-hosted GitLab, and Overleaf).
 */

import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { GitHubProvider } from "./github";
import { GitLabProvider } from "./gitlab";
import { OverleafProvider } from "./overleaf";
import type { GitProvider } from "./types";
import {
  parseRepoUrl,
  parseOverleafUrl,
  getProviderFromUrl,
  type SelfHostedGitLabInstance,
} from "../gitProviders";
import { resolveGitLabInstance } from "./gitHelpers";

// Re-export types for consumers
export type { GitProvider, CommitInfo, RepositoryInfo, FileEntry } from "./types";
export { GitHubProvider } from "./github";
export { GitLabProvider } from "./gitlab";
export { OverleafProvider } from "./overleaf";

/**
 * Token getter functions interface.
 * These are injected from git.ts to avoid circular dependencies.
 */
export interface TokenGetters {
  getGitHubToken: (ctx: ActionCtx) => Promise<string | null>;
  getGitHubTokenByUserId: (ctx: ActionCtx, userId: Id<"users">) => Promise<string | null>;
  getGitLabToken: (ctx: ActionCtx) => Promise<string | null>;
  getGitLabTokenByUserId: (ctx: ActionCtx, userId: Id<"users">) => Promise<string | null>;
  getOverleafCredentials: (ctx: ActionCtx) => Promise<{ username: string; password: string } | null>;
  getOverleafCredentialsByUserId: (ctx: ActionCtx, userId: Id<"users">) => Promise<{ username: string; password: string } | null>;
}

/**
 * Result of creating a provider via the factory.
 */
export interface ProviderResult {
  provider: GitProvider;
  owner: string;
  repo: string;
}

/**
 * Create a Git provider for the given URL.
 *
 * @param ctx - Convex action context
 * @param gitUrl - Repository URL
 * @param selfHostedInstances - List of configured self-hosted GitLab instances
 * @param tokenGetters - Functions to retrieve tokens for different providers
 * @param userId - Optional user ID for mobile auth (uses different token resolution)
 */
export async function getProvider(
  ctx: ActionCtx,
  gitUrl: string,
  selfHostedInstances: SelfHostedGitLabInstance[],
  tokenGetters: TokenGetters,
  userId?: Id<"users">
): Promise<ProviderResult> {
  const providerType = getProviderFromUrl(gitUrl, selfHostedInstances);

  // Handle Overleaf first (different URL parsing)
  if (providerType === "overleaf") {
    const overleafParsed = parseOverleafUrl(gitUrl);
    if (!overleafParsed) {
      throw new Error(
        `Invalid Overleaf URL: "${gitUrl}". Expected format: https://git.overleaf.com/<project_id> or https://www.overleaf.com/project/<project_id>`
      );
    }

    const credentials = userId
      ? await tokenGetters.getOverleafCredentialsByUserId(ctx, userId)
      : await tokenGetters.getOverleafCredentials(ctx);

    if (!credentials) {
      throw new Error("Overleaf credentials not configured.");
    }

    const latexServiceUrl = process.env.LATEX_SERVICE_URL;
    if (!latexServiceUrl) {
      throw new Error("LATEX_SERVICE_URL not configured. Required for Overleaf support.");
    }

    return {
      provider: new OverleafProvider(overleafParsed.gitUrl, credentials, latexServiceUrl),
      owner: "overleaf",
      repo: overleafParsed.projectId,
    };
  }

  // Parse as GitHub/GitLab
  const parsed = parseRepoUrl(gitUrl, selfHostedInstances);
  if (!parsed) {
    throw new Error(
      `Invalid repository URL: "${gitUrl}". Expected format: https://github.com/owner/repo, https://gitlab.com/owner/repo, https://git.overleaf.com/<project_id>, or https://www.overleaf.com/project/<project_id>`
    );
  }

  if (parsed.provider === "github") {
    const token = userId
      ? await tokenGetters.getGitHubTokenByUserId(ctx, userId)
      : await tokenGetters.getGitHubToken(ctx);

    return {
      provider: new GitHubProvider(token),
      owner: parsed.owner,
      repo: parsed.repo,
    };
  }

  // GitLab (cloud or self-hosted)
  const cloudToken = userId
    ? await tokenGetters.getGitLabTokenByUserId(ctx, userId)
    : await tokenGetters.getGitLabToken(ctx);

  const { baseUrl, token, instanceName } = resolveGitLabInstance(
    parsed,
    selfHostedInstances,
    cloudToken
  );

  return {
    provider: new GitLabProvider(token, baseUrl, instanceName),
    owner: parsed.owner,
    repo: parsed.repo,
  };
}

/**
 * Create a Git provider for public repository access (no authentication required).
 * Useful for fetching info about public repositories before the user authenticates.
 */
export function getPublicProvider(
  gitUrl: string,
  selfHostedInstances: SelfHostedGitLabInstance[] = []
): ProviderResult | null {
  const providerType = getProviderFromUrl(gitUrl, selfHostedInstances);

  if (providerType === "overleaf") {
    // Overleaf always requires auth
    return null;
  }

  const parsed = parseRepoUrl(gitUrl, selfHostedInstances);
  if (!parsed) {
    return null;
  }

  if (parsed.provider === "github") {
    return {
      provider: new GitHubProvider(null),
      owner: parsed.owner,
      repo: parsed.repo,
    };
  }

  if (parsed.provider === "gitlab") {
    return {
      provider: new GitLabProvider(""),
      owner: parsed.owner,
      repo: parsed.repo,
    };
  }

  // Self-hosted GitLab requires auth
  return null;
}

import type { Id } from "../../../convex/_generated/dataModel";

export interface Repository {
  _id: Id<"repositories">;
  name: string;
  gitUrl: string;
  defaultBranch: string;
  provider: string;
  paperCount: number;
  lastSyncedAt?: number;
  lastCommitTime?: number;
  syncStatus: "idle" | "syncing" | "error";
  paperSyncStatus?: "in_sync" | "needs_sync" | "never_synced";
  papersWithErrors: number;
  backgroundRefreshEnabled?: boolean;
}

export interface GitRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  updatedAt: string;
  ownerAvatar: string;
}

export interface RepoFile {
  name: string;
  path: string;
  type: "file" | "dir";
}

export interface SelectedFile {
  path: string;
  title: string;
  pdfSourceType: "compile" | "committed";
  compiler?: "pdflatex" | "xelatex" | "lualatex";
}

export interface SelfHostedGitLabInstance {
  _id: Id<"selfHostedGitLabInstances">;
  name: string;
  url: string;
}

export type AddRepositoryTab = "github" | "gitlab" | "overleaf" | "selfhosted" | "manual";

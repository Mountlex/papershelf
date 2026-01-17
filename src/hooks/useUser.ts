import { useQuery, useMutation } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import type { Id } from "../../convex/_generated/dataModel";

const LINK_ACCOUNT_KEY = "papershelf_link_account_intent";
const LINK_IN_PROGRESS_KEY = "papershelf_link_in_progress";

interface LinkIntent {
  originalUserId: string;
  provider: "github" | "gitlab";
}

// Store link intent before OAuth redirect
function storeLinkIntent(originalUserId: Id<"users">, provider: "github" | "gitlab") {
  if (typeof window !== "undefined") {
    const intent: LinkIntent = { originalUserId, provider };
    localStorage.setItem(LINK_ACCOUNT_KEY, JSON.stringify(intent));
  }
}

// Check for pending link intent after OAuth redirect
export function checkPendingLink(): LinkIntent | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(LINK_ACCOUNT_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as LinkIntent;
  } catch {
    return null;
  }
}

// Clear pending link intent
export function clearPendingLink() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(LINK_ACCOUNT_KEY);
    localStorage.removeItem(LINK_IN_PROGRESS_KEY);
  }
}

// Check if link is in progress (to show loading state during OAuth redirect)
export function isLinkInProgress(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(LINK_IN_PROGRESS_KEY) === "true";
}

// Set link in progress flag
function setLinkInProgress(inProgress: boolean) {
  if (typeof window !== "undefined") {
    if (inProgress) {
      localStorage.setItem(LINK_IN_PROGRESS_KEY, "true");
    } else {
      localStorage.removeItem(LINK_IN_PROGRESS_KEY);
    }
  }
}

export function useUser() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const selfHostedGitLabInstances = useQuery(
    api.users.getSelfHostedGitLabInstances,
    isAuthenticated ? {} : "skip"
  );
  const clearGitHubCredentials = useMutation(api.users.clearGitHubCredentials);
  const clearGitLabCredentials = useMutation(api.users.clearGitLabCredentials);
  const { signIn, signOut } = useAuthActions();

  // Check which providers are connected based on flags returned by viewer query
  const hasGitHub = Boolean(user?.hasGitHubToken);
  const hasGitLab = Boolean(user?.hasGitLabToken);
  const hasSelfHostedGitLab = (selfHostedGitLabInstances?.length ?? 0) > 0;

  // Link functions - sign out first, then store intent and start OAuth
  // This prevents session conflicts when adding a second provider
  const linkWithGitHub = async () => {
    if (user?._id) {
      storeLinkIntent(user._id, "github");
      setLinkInProgress(true);
      const redirectTo = typeof window !== "undefined" ? window.location.href : undefined;
      // Sign out first to avoid session conflicts
      await signOut();
      // Small delay to ensure sign out completes
      await new Promise((resolve) => setTimeout(resolve, 100));
      signIn("github", redirectTo ? { redirectTo } : undefined);
    }
  };

  const linkWithGitLab = async () => {
    if (user?._id) {
      storeLinkIntent(user._id, "gitlab");
      setLinkInProgress(true);
      const redirectTo = typeof window !== "undefined" ? window.location.href : undefined;
      // Sign out first to avoid session conflicts
      await signOut();
      // Small delay to ensure sign out completes
      await new Promise((resolve) => setTimeout(resolve, 100));
      signIn("gitlab", redirectTo ? { redirectTo } : undefined);
    }
  };

  return {
    user,
    isLoading: isAuthLoading || (isAuthenticated && user === undefined),
    isAuthenticated,
    signInWithGitHub: () =>
      signIn("github", {
        redirectTo: typeof window !== "undefined" ? window.location.href : undefined,
      }),
    signInWithGitLab: () =>
      signIn("gitlab", {
        redirectTo: typeof window !== "undefined" ? window.location.href : undefined,
      }),
    // Link functions for connecting additional providers to existing account
    linkWithGitHub,
    linkWithGitLab,
    disconnectGitHub: () => clearGitHubCredentials({}),
    disconnectGitLab: () => clearGitLabCredentials({}),
    signOut: () => signOut(),
    // Connected providers info
    connectedProviders: {
      github: hasGitHub,
      gitlab: hasGitLab,
      selfHostedGitLab: hasSelfHostedGitLab,
    },
    // List of self-hosted GitLab instances (name and URL, no tokens)
    selfHostedGitLabInstances: selfHostedGitLabInstances ?? [],
  };
}

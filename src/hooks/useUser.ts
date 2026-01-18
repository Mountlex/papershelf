import { useQuery, useMutation } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";

const LINK_ACCOUNT_KEY = "carrel_link_account_intent";
const LINK_IN_PROGRESS_KEY = "carrel_link_in_progress";
// Link intent expires after 10 minutes (must match server-side expiry)
const LINK_INTENT_TTL_MS = 10 * 60 * 1000;

interface LinkIntent {
  // Server-side intent token (secure - cannot be tampered with)
  intentToken: string;
  provider: "github" | "gitlab";
  // Client-side timestamp for expiry check
  timestamp: number;
}

// Store link intent before OAuth redirect
function storeLinkIntent(intentToken: string, provider: "github" | "gitlab") {
  if (typeof window !== "undefined") {
    const intent: LinkIntent = { intentToken, provider, timestamp: Date.now() };
    localStorage.setItem(LINK_ACCOUNT_KEY, JSON.stringify(intent));
  }
}

// Check for pending link intent after OAuth redirect
// Returns null if intent is expired or invalid
export function checkPendingLink(): LinkIntent | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(LINK_ACCOUNT_KEY);
  if (!stored) return null;
  try {
    const intent = JSON.parse(stored) as LinkIntent;
    // Security: Check client-side expiry (server also validates)
    if (Date.now() - intent.timestamp > LINK_INTENT_TTL_MS) {
      clearPendingLink();
      return null;
    }
    // Validate intent has required fields
    if (!intent.intentToken || !intent.provider) {
      clearPendingLink();
      return null;
    }
    return intent;
  } catch {
    clearPendingLink();
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
  const clearOverleafCredentials = useMutation(api.users.clearOverleafCredentials);
  const createLinkIntent = useMutation(api.users.createLinkIntent);
  const { signIn, signOut } = useAuthActions();

  // Check which providers are connected based on flags returned by viewer query
  const hasGitHub = Boolean(user?.hasGitHubToken);
  const hasGitLab = Boolean(user?.hasGitLabToken);
  const hasOverleaf = Boolean(user?.hasOverleafCredentials);
  const hasSelfHostedGitLab = (selfHostedGitLabInstances?.length ?? 0) > 0;

  // Link functions - create server-side intent, sign out, then start OAuth
  // Security: Uses server-side intent token instead of client-stored userId
  const linkWithGitHub = async () => {
    if (user?._id) {
      try {
        // Create server-side intent token (secure - cannot be tampered)
        const { intentToken } = await createLinkIntent({ provider: "github" });
        storeLinkIntent(intentToken, "github");
        setLinkInProgress(true);
        const redirectTo = typeof window !== "undefined" ? window.location.href : undefined;
        // Sign out first to avoid session conflicts
        await signOut();
        // Small delay to ensure sign out completes
        await new Promise((resolve) => setTimeout(resolve, 100));
        signIn("github", redirectTo ? { redirectTo } : undefined);
      } catch (error) {
        console.error("Failed to create link intent:", error);
        setLinkInProgress(false);
      }
    }
  };

  const linkWithGitLab = async () => {
    if (user?._id) {
      try {
        // Create server-side intent token (secure - cannot be tampered)
        const { intentToken } = await createLinkIntent({ provider: "gitlab" });
        storeLinkIntent(intentToken, "gitlab");
        setLinkInProgress(true);
        const redirectTo = typeof window !== "undefined" ? window.location.href : undefined;
        // Sign out first to avoid session conflicts
        await signOut();
        // Small delay to ensure sign out completes
        await new Promise((resolve) => setTimeout(resolve, 100));
        signIn("gitlab", redirectTo ? { redirectTo } : undefined);
      } catch (error) {
        console.error("Failed to create link intent:", error);
        setLinkInProgress(false);
      }
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
    disconnectOverleaf: () => clearOverleafCredentials({}),
    signOut: () => signOut(),
    // Connected providers info
    connectedProviders: {
      github: hasGitHub,
      gitlab: hasGitLab,
      overleaf: hasOverleaf,
      selfHostedGitLab: hasSelfHostedGitLab,
    },
    // List of self-hosted GitLab instances (name and URL, no tokens)
    selfHostedGitLabInstances: selfHostedGitLabInstances ?? [],
  };
}

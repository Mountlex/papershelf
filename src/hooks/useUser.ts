import { useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";

export function useUser() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const selfHostedGitLabInstances = useQuery(
    api.users.getSelfHostedGitLabInstances,
    isAuthenticated ? {} : "skip"
  );
  const { signIn, signOut } = useAuthActions();

  // Check which providers are connected based on flags returned by viewer query
  const hasGitHub = Boolean(user?.hasGitHubToken);
  const hasGitLab = Boolean(user?.hasGitLabToken);
  const hasSelfHostedGitLab = (selfHostedGitLabInstances?.length ?? 0) > 0;

  return {
    user,
    isLoading: isAuthLoading || (isAuthenticated && user === undefined),
    isAuthenticated,
    signInWithGitHub: () => signIn("github"),
    signInWithGitLab: () => signIn("gitlab"),
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

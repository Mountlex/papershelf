import { useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";

export function useUser() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const { signIn, signOut } = useAuthActions();

  return {
    user,
    isLoading: isAuthLoading || (isAuthenticated && user === undefined),
    isAuthenticated,
    signIn: () => signIn("github"),
    signOut: () => signOut(),
  };
}

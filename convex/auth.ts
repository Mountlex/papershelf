import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";
import type { TokenSet } from "@auth/core/types";

interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    GitHub({
      authorization: {
        params: {
          // Request access to private repos
          scope: "read:user user:email repo",
        },
      },
      profile(profile: GitHubProfile, tokens: TokenSet) {
        return {
          id: String(profile.id),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          // Store the access token for API calls
          githubAccessToken: tokens.access_token,
        };
      },
    }),
  ],
});

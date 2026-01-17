import GitHub from "@auth/core/providers/github";
import GitLab from "@auth/core/providers/gitlab";
import { convexAuth } from "@convex-dev/auth/server";
import type { TokenSet } from "@auth/core/types";

interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface GitLabProfile {
  id: number;
  sub: string; // GitLab returns 'sub' as the user ID in OAuth
  username: string;
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
    GitLab({
      // Override the default authorization URL to include read_api scope
      authorization: "https://gitlab.com/oauth/authorize?scope=read_user+read_api",
      profile(profile: GitLabProfile, tokens: TokenSet) {
        return {
          id: profile.sub ?? String(profile.id),
          name: profile.name ?? profile.username,
          email: profile.email,
          image: profile.avatar_url,
          // Store the access token for API calls
          gitlabAccessToken: tokens.access_token,
        };
      },
    }),
  ],
});

import GitHub from "@auth/core/providers/github";
import GitLab from "@auth/core/providers/gitlab";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { TokenSet } from "@auth/core/types";
import { ResendOTP, ResendOTPPasswordReset } from "./ResendOTP";
import type { DataModel } from "./_generated/dataModel";

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
        // Calculate token expiry time (expires_in is in seconds, default 7200 = 2 hours)
        const expiresIn = tokens.expires_in ?? 7200;
        const expiresAt = Date.now() + expiresIn * 1000;

        return {
          id: profile.sub ?? String(profile.id),
          name: profile.name ?? profile.username,
          email: profile.email,
          image: profile.avatar_url,
          // Store the access token and refresh token for API calls
          gitlabAccessToken: tokens.access_token,
          gitlabRefreshToken: tokens.refresh_token,
          gitlabTokenExpiresAt: expiresAt,
        };
      },
    }),
    Password<DataModel>({
      profile(params) {
        return {
          email: params.email as string,
          name: (params.name as string) || undefined,
        };
      },
      verify: ResendOTP,
      reset: ResendOTPPasswordReset,
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, { existingUserId, profile }) {
      if (existingUserId) {
        // User exists - only update tokens, preserve email
        const existingUser = await ctx.db.get(existingUserId);
        if (existingUser) {
          const updates: Record<string, unknown> = {};

          // Update tokens if provided (from OAuth)
          if (profile.githubAccessToken) {
            updates.githubAccessToken = profile.githubAccessToken;
          }
          if (profile.gitlabAccessToken) {
            updates.gitlabAccessToken = profile.gitlabAccessToken;
          }
          if (profile.gitlabRefreshToken) {
            updates.gitlabRefreshToken = profile.gitlabRefreshToken;
          }
          if (profile.gitlabTokenExpiresAt) {
            updates.gitlabTokenExpiresAt = profile.gitlabTokenExpiresAt;
          }

          // Only update name if user doesn't have one
          if (!existingUser.name && profile.name) {
            updates.name = profile.name;
          }

          // Never overwrite email on existing users

          if (Object.keys(updates).length > 0) {
            await ctx.db.patch(existingUserId, updates);
          }
          return existingUserId;
        }
      }

      // New user - create with full profile
      return ctx.db.insert("users", {
        name: profile.name,
        email: profile.email,
        image: profile.image,
        emailVerificationTime: profile.emailVerificationTime,
        githubAccessToken: profile.githubAccessToken,
        gitlabAccessToken: profile.gitlabAccessToken,
        gitlabRefreshToken: profile.gitlabRefreshToken,
        gitlabTokenExpiresAt: profile.gitlabTokenExpiresAt,
      });
    },
  },
});

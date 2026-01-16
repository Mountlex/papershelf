import { v } from "convex/values";
import { query } from "./_generated/server";
import { auth } from "./auth";

// Get the currently authenticated user
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get(userId);
    return user;
  },
});

// Get user by ID
export const get = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get the GitHub access token for the current user
export const getGitHubToken = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return null;
    }

    // Find the GitHub account linked to this user
    const account = await ctx.db
      .query("authAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("provider"), "github")
        )
      )
      .first();

    if (!account) {
      return null;
    }

    // The access token is stored in the account's providerAccountId
    // For OAuth providers, we need to get the token from the session or refresh it
    // Convex Auth stores the access token in the account
    return account;
  },
});

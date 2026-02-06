import { internalMutation } from "./_generated/server";

// Session expiry: 30 days
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Rate limit window expiry: 24 hours
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Maximum records to process per table per run (prevents bandwidth spikes)
const CLEANUP_BATCH_SIZE = 500;

/**
 * Internal mutation to clean up expired sessions and tokens.
 * Called daily by the cron job.
 *
 * Cleans up:
 * - authSessions older than 30 days
 * - Expired mobileTokens (by expiresAt)
 * - Revoked mobileTokens
 * - Expired linkIntents (by expiresAt)
 * - Used or expired passwordChangeCodes
 * - Stale emailRateLimits (window > 24 hours old)
 *
 * Each table is limited to CLEANUP_BATCH_SIZE records per run.
 * Remaining records will be cleaned up on the next daily run.
 */
export const cleanupExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sessionCutoff = now - SESSION_MAX_AGE_MS;
    const rateLimitCutoff = now - RATE_LIMIT_WINDOW_MS;

    const counts = {
      authSessions: 0,
      mobileTokens: 0,
      linkIntents: 0,
      passwordChangeCodes: 0,
      emailRateLimits: 0,
      userRateLimits: 0,
      userRateLimitAttempts: 0,
      userRateLimitLocks: 0,
    };

    // Clean up old auth sessions (by _creationTime)
    const oldSessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.lt(q.field("_creationTime"), sessionCutoff))
      .take(CLEANUP_BATCH_SIZE);

    for (const session of oldSessions) {
      await ctx.db.delete(session._id);
      counts.authSessions++;
    }

    // Clean up expired or revoked mobile tokens
    const allMobileTokens = await ctx.db.query("mobileTokens").take(CLEANUP_BATCH_SIZE);
    for (const token of allMobileTokens) {
      if (token.isRevoked || token.expiresAt < now) {
        await ctx.db.delete(token._id);
        counts.mobileTokens++;
      }
    }

    // Clean up expired link intents
    const allLinkIntents = await ctx.db.query("linkIntents").take(CLEANUP_BATCH_SIZE);
    for (const intent of allLinkIntents) {
      if (intent.expiresAt < now) {
        await ctx.db.delete(intent._id);
        counts.linkIntents++;
      }
    }

    // Clean up used or expired password change codes
    const allPasswordCodes = await ctx.db.query("passwordChangeCodes").take(CLEANUP_BATCH_SIZE);
    for (const code of allPasswordCodes) {
      if (code.used || code.expiresAt < now) {
        await ctx.db.delete(code._id);
        counts.passwordChangeCodes++;
      }
    }

    // Clean up stale email rate limits (window older than 24 hours)
    const allRateLimits = await ctx.db.query("emailRateLimits").take(CLEANUP_BATCH_SIZE);
    for (const limit of allRateLimits) {
      if (limit.windowStart < rateLimitCutoff) {
        await ctx.db.delete(limit._id);
        counts.emailRateLimits++;
      }
    }

    const allUserRateLimits = await ctx.db.query("userRateLimits").take(CLEANUP_BATCH_SIZE);
    for (const limit of allUserRateLimits) {
      if (limit.windowStart < rateLimitCutoff) {
        await ctx.db.delete(limit._id);
        counts.userRateLimits++;
      }
    }

    const allUserRateLimitAttempts = await ctx.db.query("userRateLimitAttempts").take(CLEANUP_BATCH_SIZE);
    for (const attempt of allUserRateLimitAttempts) {
      if (attempt.attemptedAt < rateLimitCutoff) {
        await ctx.db.delete(attempt._id);
        counts.userRateLimitAttempts++;
      }
    }

    const allUserRateLimitLocks = await ctx.db.query("userRateLimitLocks").take(CLEANUP_BATCH_SIZE);
    for (const lock of allUserRateLimitLocks) {
      if (lock.lockedUntil < now) {
        await ctx.db.delete(lock._id);
        counts.userRateLimitLocks++;
      }
    }

    console.log(
      `Session cleanup completed: ${JSON.stringify(counts)}`
    );

    return counts;
  },
});

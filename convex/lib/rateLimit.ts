import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

type RateLimitAction = "otp_send" | "otp_verify" | "password_reset" | "signup";

// User-based rate limit actions for compute-intensive operations
export type UserRateLimitAction =
  | "refresh_repository"
  | "build_paper"
  | "refresh_all_repositories"
  | "background_refresh";

interface RateLimitConfig {
  windowMs: number;
  max: number;
  lockoutMs: number;
}

const LIMITS: Record<RateLimitAction, RateLimitConfig> = {
  otp_send: { windowMs: 3600000, max: 5, lockoutMs: 3600000 }, // 5 per hour, 1 hour lockout
  otp_verify: { windowMs: 900000, max: 5, lockoutMs: 1800000 }, // 5 per 15 min, 30 min lockout
  password_reset: { windowMs: 3600000, max: 3, lockoutMs: 3600000 }, // 3 per hour, 1 hour lockout
  signup: { windowMs: 3600000, max: 5, lockoutMs: 3600000 }, // 5 per hour, 1 hour lockout
};

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
}

// Shared rate limit record interface
interface RateLimitRecord {
  _id: Id<"emailRateLimits">;
  attempts: number;
  windowStart: number;
  lastAttempt: number;
  lockedUntil?: number;
}

/**
 * Core rate limit logic shared between email-based and user-based rate limiting.
 * Handles lockout checking, window expiration, and attempt incrementing.
 */
async function checkRateLimitCore(
  config: RateLimitConfig,
  record: RateLimitRecord | null,
  createRecord: () => Promise<void>,
  updateRecord: (id: RateLimitRecord["_id"], updates: Partial<RateLimitRecord>) => Promise<void>
): Promise<RateLimitResult> {
  const now = Date.now();

  // Check if currently locked out
  if (record?.lockedUntil && now < record.lockedUntil) {
    return { allowed: false, retryAfter: record.lockedUntil - now };
  }

  // No record or expired window - create/reset
  if (!record || now - record.windowStart > config.windowMs) {
    if (record) {
      await updateRecord(record._id, {
        attempts: 1,
        windowStart: now,
        lastAttempt: now,
        lockedUntil: undefined,
      });
    } else {
      await createRecord();
    }
    return { allowed: true, remaining: config.max - 1 };
  }

  // Check if max attempts reached
  if (record.attempts >= config.max) {
    await updateRecord(record._id, { lockedUntil: now + config.lockoutMs });
    return { allowed: false, retryAfter: config.lockoutMs };
  }

  // Increment attempts
  await updateRecord(record._id, {
    attempts: record.attempts + 1,
    lastAttempt: now,
  });

  return { allowed: true, remaining: config.max - record.attempts - 1 };
}

export async function checkRateLimit(
  ctx: MutationCtx,
  email: string,
  action: RateLimitAction
): Promise<RateLimitResult> {
  const config = LIMITS[action];
  const now = Date.now();
  const normalizedEmail = email.toLowerCase().trim();

  const record = await ctx.db
    .query("emailRateLimits")
    .withIndex("by_email_action", (q) =>
      q.eq("email", normalizedEmail).eq("action", action)
    )
    .first();

  return checkRateLimitCore(
    config,
    record,
    async () => {
      await ctx.db.insert("emailRateLimits", {
        email: normalizedEmail,
        action,
        attempts: 1,
        windowStart: now,
        lastAttempt: now,
      });
    },
    async (id, updates) => {
      await ctx.db.patch(id as Id<"emailRateLimits">, updates);
    }
  );
}

export async function resetRateLimit(
  ctx: MutationCtx,
  email: string,
  action: RateLimitAction
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  const record = await ctx.db
    .query("emailRateLimits")
    .withIndex("by_email_action", (q) =>
      q.eq("email", normalizedEmail).eq("action", action)
    )
    .first();

  if (record) {
    await ctx.db.delete(record._id);
  }
}

// User-based rate limits for compute-intensive operations
const USER_LIMITS: Record<UserRateLimitAction, RateLimitConfig> = {
  refresh_repository: { windowMs: 60000, max: 30, lockoutMs: 60000 },      // 30/min, 1 min lockout
  build_paper: { windowMs: 60000, max: 20, lockoutMs: 60000 },             // 20/min, 1 min lockout
  refresh_all_repositories: { windowMs: 300000, max: 5, lockoutMs: 300000 }, // 5/5min, 5 min lockout
  background_refresh: { windowMs: 60000, max: 1, lockoutMs: 60000 },         // TEMP: 1/min for testing
};

export function getUserRateLimitConfig(action: UserRateLimitAction): RateLimitConfig {
  return USER_LIMITS[action];
}

export async function checkUserRateLimit(
  ctx: MutationCtx,
  userId: Id<"users">,
  action: UserRateLimitAction
): Promise<RateLimitResult> {
  const config = USER_LIMITS[action];
  const now = Date.now();

  const lock = await ctx.db
    .query("userRateLimitLocks")
    .withIndex("by_user_action", (q) =>
      q.eq("userId", userId).eq("action", action)
    )
    .first();

  if (lock?.lockedUntil && now < lock.lockedUntil) {
    return { allowed: false, retryAfter: lock.lockedUntil - now };
  }

  if (lock?.lockedUntil && now >= lock.lockedUntil) {
    await ctx.db.delete(lock._id);
  }

  const windowStart = now - config.windowMs;
  const attempts = await ctx.db
    .query("userRateLimitAttempts")
    .withIndex("by_user_action_time", (q) =>
      q.eq("userId", userId).eq("action", action).gte("attemptedAt", windowStart)
    )
    .collect();

  if (attempts.length >= config.max) {
    const lockedUntil = now + config.lockoutMs;
    if (lock) {
      await ctx.db.patch(lock._id, { lockedUntil });
    } else {
      await ctx.db.insert("userRateLimitLocks", {
        userId,
        action,
        lockedUntil,
      });
    }
    return { allowed: false, retryAfter: config.lockoutMs };
  }

  await ctx.db.insert("userRateLimitAttempts", {
    userId,
    action,
    attemptedAt: now,
  });

  return { allowed: true, remaining: config.max - attempts.length - 1 };
}

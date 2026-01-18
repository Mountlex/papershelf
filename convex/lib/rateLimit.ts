import type { MutationCtx } from "../_generated/server";

type RateLimitAction = "otp_send" | "otp_verify" | "password_reset" | "signup";

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

  // Check if currently locked out
  if (record?.lockedUntil && now < record.lockedUntil) {
    return { allowed: false, retryAfter: record.lockedUntil - now };
  }

  // No record or expired window - create/reset
  if (!record || now - record.windowStart > config.windowMs) {
    if (record) {
      await ctx.db.patch(record._id, {
        attempts: 1,
        windowStart: now,
        lastAttempt: now,
        lockedUntil: undefined,
      });
    } else {
      await ctx.db.insert("emailRateLimits", {
        email: normalizedEmail,
        action,
        attempts: 1,
        windowStart: now,
        lastAttempt: now,
      });
    }
    return { allowed: true, remaining: config.max - 1 };
  }

  // Check if max attempts reached
  if (record.attempts >= config.max) {
    await ctx.db.patch(record._id, { lockedUntil: now + config.lockoutMs });
    return { allowed: false, retryAfter: config.lockoutMs };
  }

  // Increment attempts
  await ctx.db.patch(record._id, {
    attempts: record.attempts + 1,
    lastAttempt: now,
  });

  return { allowed: true, remaining: config.max - record.attempts - 1 };
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

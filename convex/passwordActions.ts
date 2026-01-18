"use node";

/// <reference types="node" />

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import * as crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

// Hash code using SHA-256 (for verification codes)
function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// Generate random numeric code
function generateCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map((b: number) => (b % 10).toString())
    .join("");
}

// Hash password using scrypt with Lucia's format (used by @convex-dev/auth)
// Lucia Scrypt format: ${hexSalt}:${hexKey}
// Parameters: N=16384, r=16, p=1, dkLen=64
// Memory required: 128 * N * r = 32MB, so we set maxmem to 64MB
// Important: Lucia passes the salt as a string (hex-encoded) to scrypt, not raw bytes
async function hashPassword(password: string): Promise<string> {
  // Generate 16 random bytes, convert to lowercase hex (32 chars)
  const saltBytes = crypto.randomBytes(16);
  const salt = saltBytes.toString("hex").toLowerCase();

  // Normalize password with NFKC (as Lucia does)
  const normalizedPassword = password.normalize("NFKC");

  const N = 16384;
  const r = 16;
  const p = 1;
  const dkLen = 64;
  const maxmem = 64 * 1024 * 1024; // 64MB

  // Lucia passes the salt STRING (hex) to scrypt, not the raw bytes
  // This means scrypt receives the UTF-8 encoding of the hex string as salt
  const key = await scryptAsync(normalizedPassword, salt, dkLen, { N, r, p, maxmem }) as Buffer;

  // Format: hexSalt:hexKey (Lucia's format)
  return `${salt}:${key.toString("hex").toLowerCase()}`;
}

// Action to request a password change code (sends email)
export const requestPasswordChangeCode = action({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Get user email
    const email = await ctx.runQuery(internal.users.getUserEmailInternal, { userId });
    if (!email) {
      throw new Error("No email associated with this account");
    }

    // Generate a random 6-digit code
    const code = generateCode(6);

    // Hash the code before storing (using SHA-256)
    const codeHash = hashCode(code);

    // Store the hashed code (expires in 15 minutes)
    const expiresAt = Date.now() + 15 * 60 * 1000;
    await ctx.runMutation(internal.users.storePasswordChangeCode, {
      userId,
      codeHash,
      expiresAt,
    });

    // Send email via Resend
    const resendKey = process.env.AUTH_RESEND_KEY;
    if (!resendKey) {
      throw new Error("Email service not configured");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PaperShelf <onboarding@resend.dev>",
        to: [email],
        subject: `Your PaperShelf password change code: ${code}`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #111827;">Change your password</h2>
            <p style="color: #4b5563;">Enter this code to change your password:</p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #111827;">${code}</span>
            </div>
            <p style="color: #6b7280; font-size: 14px;">This code expires in 15 minutes.</p>
            <p style="color: #6b7280; font-size: 14px;">If you didn't request this, please secure your account immediately.</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send email: ${error}`);
    }

    return { success: true };
  },
});

// Action to change password with verification code
export const changePassword = action({
  args: {
    code: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Validate password
    if (args.newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    if (!/[A-Z]/.test(args.newPassword)) {
      throw new Error("Password must contain at least one uppercase letter");
    }
    if (!/[0-9]/.test(args.newPassword)) {
      throw new Error("Password must contain at least one number");
    }

    // Get the stored code
    const storedCode = await ctx.runQuery(internal.users.getPasswordChangeCode, { userId });
    if (!storedCode) {
      throw new Error("No valid code found. Please request a new one.");
    }

    // Verify the code (SHA-256 comparison)
    const providedCodeHash = hashCode(args.code);
    if (providedCodeHash !== storedCode.codeHash) {
      throw new Error("Invalid verification code");
    }

    // Hash the new password using scrypt (same format as oslo/password)
    const newPasswordHash = await hashPassword(args.newPassword);

    // Update password and mark code as used
    await ctx.runMutation(internal.users.updatePasswordAndMarkCodeUsed, {
      userId,
      codeId: storedCode.codeId,
      newPasswordHash,
    });

    // Log the password change
    await ctx.runMutation(internal.users.logPasswordChange, { userId });

    return { success: true };
  },
});

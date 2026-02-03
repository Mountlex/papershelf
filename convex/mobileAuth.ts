import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { auth } from "./auth";

// Token configuration
const ACCESS_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days - longer for mobile convenience
const REFRESH_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days - users rarely need to re-login
const CONVEX_AUTH_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days for Convex Auth tokens

// Simple hash function for refresh tokens (using Web Crypto API compatible approach)
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate a cryptographically secure random token
function generateSecureToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Base64URL encode (for JWT)
function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Base64URL decode
function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

// Create a simple JWT (signed with HMAC-SHA256)
async function createJwt(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const signatureB64 = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${message}.${signatureB64}`;
}

// Create a Convex Auth-compatible JWT (signed with RSA-256)
// This token will be accepted by Convex for real-time subscriptions
async function createConvexAuthJwt(
  userId: string,
  expiresInMs: number = CONVEX_AUTH_TOKEN_EXPIRY_MS
): Promise<string> {
  const privateKeyPem = process.env.JWT_PRIVATE_KEY;
  if (!privateKeyPem) {
    throw new Error("JWT_PRIVATE_KEY environment variable is not set");
  }

  // Convex deployment URL for issuer
  const issuer = process.env.CONVEX_SITE_URL || "https://kindhearted-bloodhound-95.convex.site";

  const now = Math.floor(Date.now() / 1000);
  const exp = Math.floor((Date.now() + expiresInMs) / 1000);

  // Create a session-like subject (userId|randomSessionId)
  const sessionId = generateSecureToken().substring(0, 32);
  const subject = `${userId}|${sessionId}`;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    sub: subject,
    iat: now,
    iss: issuer,
    aud: "convex",
    exp: exp,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;

  // Parse PEM and import RSA private key
  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(message)
  );

  const signatureB64 = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${message}.${signatureB64}`;
}

// Verify a JWT and return the payload
async function verifyJwt(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const message = `${headerB64}.${payloadB64}`;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureStr = base64UrlDecode(signatureB64);
    const signature = new Uint8Array(signatureStr.length);
    for (let i = 0; i < signatureStr.length; i++) {
      signature[i] = signatureStr.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(message)
    );

    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64));

    // Check expiration
    if (payload.exp && Date.now() > payload.exp * 1000) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// Internal query to get JWT secret from environment
export const getJwtSecret = internalQuery({
  args: {},
  handler: async (): Promise<string> => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET environment variable is not set");
    }
    return secret;
  },
});

// Internal query to validate a Convex Auth session token and get user ID
// The Convex Auth token is a JWT signed with RSA - we decode it to get the subject (user ID)
export const validateConvexToken = internalQuery({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{ userId: string } | null> => {
    try {
      // Decode the JWT payload (Convex Auth tokens are standard JWTs)
      const parts = args.token.split(".");
      if (parts.length !== 3) {
        console.log("validateConvexToken: Invalid JWT format");
        return null;
      }

      // Decode the payload (base64url encoded)
      let base64 = parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/");

      // Add padding if needed
      while (base64.length % 4 !== 0) {
        base64 += "=";
      }

      const payloadJson = atob(base64);
      const payload = JSON.parse(payloadJson);

      // Check expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        console.log("validateConvexToken: Token expired");
        return null;
      }

      // Get the subject (user ID) - Convex Auth uses 'sub' claim
      const subject = payload.sub;
      if (!subject) {
        console.log("validateConvexToken: No subject in token");
        return null;
      }

      // The subject format in Convex Auth is typically the user ID or a compound ID
      // Try to extract the user ID and verify the user exists
      // Format might be "userId" or "userId|sessionId"
      const userId = subject.includes("|") ? subject.split("|")[0] : subject;

      // Verify the user exists in our database
      try {
        const user = await ctx.db.get(userId as any);
        if (!user) {
          console.log("validateConvexToken: User not found:", userId);
          return null;
        }
        return { userId };
      } catch {
        console.log("validateConvexToken: Invalid user ID format:", userId);
        return null;
      }
    } catch (error) {
      console.error("validateConvexToken: Error decoding token:", error);
      return null;
    }
  },
});

// Internal mutation to create a mobile token record
export const createMobileTokenRecord = internalMutation({
  args: {
    userId: v.id("users"),
    refreshTokenHash: v.string(),
    deviceId: v.optional(v.string()),
    deviceName: v.optional(v.string()),
    platform: v.optional(v.union(v.literal("ios"), v.literal("android"), v.literal("unknown"))),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // If deviceId is provided, revoke any existing tokens for this device
    if (args.deviceId) {
      const existingTokens = await ctx.db
        .query("mobileTokens")
        .withIndex("by_user_and_device", (q) =>
          q.eq("userId", args.userId).eq("deviceId", args.deviceId)
        )
        .collect();

      for (const token of existingTokens) {
        if (!token.isRevoked) {
          await ctx.db.patch(token._id, {
            isRevoked: true,
            revokedAt: Date.now(),
          });
        }
      }
    }

    return await ctx.db.insert("mobileTokens", {
      userId: args.userId,
      refreshTokenHash: args.refreshTokenHash,
      deviceId: args.deviceId,
      deviceName: args.deviceName,
      platform: args.platform,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      isRevoked: false,
    });
  },
});

// Internal query to validate a refresh token
export const validateRefreshToken = internalQuery({
  args: {
    refreshTokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenRecord = await ctx.db
      .query("mobileTokens")
      .withIndex("by_refresh_token_hash", (q) =>
        q.eq("refreshTokenHash", args.refreshTokenHash)
      )
      .first();

    if (!tokenRecord) {
      return null;
    }

    if (tokenRecord.isRevoked) {
      return null;
    }

    if (Date.now() > tokenRecord.expiresAt) {
      return null;
    }

    return tokenRecord;
  },
});

// Internal mutation to update last used time
export const updateTokenLastUsed = internalMutation({
  args: {
    tokenId: v.id("mobileTokens"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tokenId, {
      lastUsedAt: Date.now(),
    });
  },
});

// Internal mutation to revoke a token
export const revokeTokenInternal = internalMutation({
  args: {
    tokenId: v.id("mobileTokens"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tokenId, {
      isRevoked: true,
      revokedAt: Date.now(),
    });
  },
});

// Internal query to get user by ID
export const getUserById = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

// Internal query to get password hash for a user (for email auth)
export const getPasswordHash = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<string | null> => {
    // Find the authAccount for this user with password provider
    const account = await ctx.db
      .query("authAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("provider"), "password")
        )
      )
      .first();

    if (!account || !account.secret) {
      return null;
    }

    return account.secret;
  },
});

// Mutation to revoke a specific token (user-facing, for logout)
export const revokeToken = mutation({
  args: {
    tokenId: v.id("mobileTokens"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const token = await ctx.db.get(args.tokenId);
    if (!token) {
      throw new Error("Token not found");
    }

    // Verify ownership
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user || token.userId !== user._id) {
      throw new Error("Unauthorized");
    }

    await ctx.db.patch(args.tokenId, {
      isRevoked: true,
      revokedAt: Date.now(),
    });

    return { success: true };
  },
});

// Mutation to revoke all tokens for current user (logout everywhere)
export const revokeAllTokens = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const tokens = await ctx.db
      .query("mobileTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const now = Date.now();
    for (const token of tokens) {
      if (!token.isRevoked) {
        await ctx.db.patch(token._id, {
          isRevoked: true,
          revokedAt: now,
        });
      }
    }

    return { success: true, revokedCount: tokens.filter((t) => !t.isRevoked).length };
  },
});

// Mutation to generate mobile tokens for the current authenticated user
// This is called by the web app after the user logs in
export const generateMobileTokens = mutation({
  args: {
    deviceId: v.optional(v.string()),
    deviceName: v.optional(v.string()),
    platform: v.optional(v.union(v.literal("ios"), v.literal("android"), v.literal("unknown"))),
  },
  handler: async (ctx, args) => {
    // Use auth.getUserId which is the proper way to get user ID in Convex Auth
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get identity for email/name (optional fields for JWT)
    const identity = await ctx.auth.getUserIdentity();

    // Get JWT secret
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET not configured");
    }

    // Generate tokens
    const now = Date.now();
    const accessTokenExpiry = now + ACCESS_TOKEN_EXPIRY_MS;
    const refreshToken = generateSecureToken();
    const refreshTokenExpiry = now + REFRESH_TOKEN_EXPIRY_MS;

    // Create JWT access token (use user fields, fallback to identity)
    const accessToken = await createJwt(
      {
        iss: "carrel-mobile",
        sub: user._id,
        email: user.email || identity?.email,
        name: user.name || identity?.name,
        iat: Math.floor(now / 1000),
        exp: Math.floor(accessTokenExpiry / 1000),
      },
      jwtSecret
    );

    // Store refresh token hash
    const refreshTokenHash = await hashToken(refreshToken);

    // If deviceId is provided, revoke any existing tokens for this device
    if (args.deviceId) {
      const existingTokens = await ctx.db
        .query("mobileTokens")
        .withIndex("by_user_and_device", (q) =>
          q.eq("userId", userId).eq("deviceId", args.deviceId)
        )
        .collect();

      for (const token of existingTokens) {
        if (!token.isRevoked) {
          await ctx.db.patch(token._id, {
            isRevoked: true,
            revokedAt: Date.now(),
          });
        }
      }
    }

    await ctx.db.insert("mobileTokens", {
      userId,
      refreshTokenHash,
      deviceId: args.deviceId,
      deviceName: args.deviceName,
      platform: args.platform,
      createdAt: Date.now(),
      expiresAt: refreshTokenExpiry,
      isRevoked: false,
    });

    return {
      accessToken,
      refreshToken,
      expiresAt: accessTokenExpiry,
      refreshExpiresAt: refreshTokenExpiry,
      tokenType: "Bearer",
    };
  },
});

// Query to list active tokens for current user
export const listActiveTokens = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return [];
    }

    const tokens = await ctx.db
      .query("mobileTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const now = Date.now();
    return tokens
      .filter((t) => !t.isRevoked && t.expiresAt > now)
      .map((t) => ({
        id: t._id,
        deviceId: t.deviceId,
        deviceName: t.deviceName,
        platform: t.platform,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
      }));
  },
});

// Export utilities for use in HTTP handlers
export {
  hashToken,
  generateSecureToken,
  createJwt,
  createConvexAuthJwt,
  verifyJwt,
  ACCESS_TOKEN_EXPIRY_MS,
  REFRESH_TOKEN_EXPIRY_MS,
  CONVEX_AUTH_TOKEN_EXPIRY_MS,
};

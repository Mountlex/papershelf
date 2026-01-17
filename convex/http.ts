import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import {
  hashToken,
  generateSecureToken,
  createJwt,
  verifyJwt,
  ACCESS_TOKEN_EXPIRY_MS,
  REFRESH_TOKEN_EXPIRY_MS,
} from "./mobileAuth";

const http = httpRouter();

auth.addHttpRoutes(http);

// CORS headers for mobile auth endpoints
function corsHeaders(origin?: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// Helper to create JSON response with CORS
function jsonResponse(
  data: unknown,
  status: number = 200,
  origin?: string | null
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

// OPTIONS handler for CORS preflight
http.route({
  path: "/api/auth/mobile/token",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/auth/mobile/refresh",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/auth/mobile/revoke",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

// POST /api/auth/mobile/token - Exchange session for JWT tokens
// This endpoint requires an existing authenticated session (cookie-based)
http.route({
  path: "/api/auth/mobile/token",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    try {
      // Verify the user is authenticated via session
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        return jsonResponse({ error: "Not authenticated" }, 401, origin);
      }

      // Parse request body for device info
      let deviceId: string | undefined;
      let deviceName: string | undefined;
      let platform: "ios" | "android" | "unknown" | undefined;

      try {
        const body = await request.json();
        deviceId = body.deviceId;
        deviceName = body.deviceName;
        platform = body.platform;
      } catch {
        // Body is optional
      }

      // Get JWT secret
      const jwtSecret = await ctx.runQuery(internal.mobileAuth.getJwtSecret);

      // Find the user in the database
      const user = await ctx.runQuery(internal.users.getUserByEmail, {
        email: identity.email!,
      });

      if (!user) {
        return jsonResponse({ error: "User not found" }, 404, origin);
      }

      // Generate tokens
      const now = Date.now();
      const accessTokenExpiry = now + ACCESS_TOKEN_EXPIRY_MS;
      const refreshToken = generateSecureToken();
      const refreshTokenExpiry = now + REFRESH_TOKEN_EXPIRY_MS;

      // Create JWT access token
      const accessToken = await createJwt(
        {
          sub: user._id,
          email: identity.email,
          name: identity.name,
          iat: Math.floor(now / 1000),
          exp: Math.floor(accessTokenExpiry / 1000),
        },
        jwtSecret
      );

      // Store refresh token hash
      const refreshTokenHash = await hashToken(refreshToken);
      await ctx.runMutation(internal.mobileAuth.createMobileTokenRecord, {
        userId: user._id,
        refreshTokenHash,
        deviceId,
        deviceName,
        platform,
        expiresAt: refreshTokenExpiry,
      });

      return jsonResponse(
        {
          accessToken,
          refreshToken,
          expiresAt: accessTokenExpiry,
          refreshExpiresAt: refreshTokenExpiry,
          tokenType: "Bearer",
        },
        200,
        origin
      );
    } catch (error) {
      console.error("Token issuance error:", error);
      return jsonResponse(
        { error: "Internal server error" },
        500,
        origin
      );
    }
  }),
});

// POST /api/auth/mobile/refresh - Refresh access token using refresh token
http.route({
  path: "/api/auth/mobile/refresh",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    try {
      const body = await request.json();
      const { refreshToken } = body;

      if (!refreshToken) {
        return jsonResponse({ error: "Missing refresh token" }, 400, origin);
      }

      // Hash and validate the refresh token
      const refreshTokenHash = await hashToken(refreshToken);
      const tokenRecord = await ctx.runQuery(
        internal.mobileAuth.validateRefreshToken,
        { refreshTokenHash }
      );

      if (!tokenRecord) {
        return jsonResponse({ error: "Invalid or expired refresh token" }, 401, origin);
      }

      // Get JWT secret
      const jwtSecret = await ctx.runQuery(internal.mobileAuth.getJwtSecret);

      // Get user
      const user = await ctx.runQuery(internal.mobileAuth.getUserById, {
        userId: tokenRecord.userId,
      });

      if (!user) {
        return jsonResponse({ error: "User not found" }, 404, origin);
      }

      // Update last used time
      await ctx.runMutation(internal.mobileAuth.updateTokenLastUsed, {
        tokenId: tokenRecord._id,
      });

      // Generate new access token
      const now = Date.now();
      const accessTokenExpiry = now + ACCESS_TOKEN_EXPIRY_MS;

      const accessToken = await createJwt(
        {
          sub: user._id,
          email: user.email,
          name: user.name,
          iat: Math.floor(now / 1000),
          exp: Math.floor(accessTokenExpiry / 1000),
        },
        jwtSecret
      );

      return jsonResponse(
        {
          accessToken,
          expiresAt: accessTokenExpiry,
          tokenType: "Bearer",
        },
        200,
        origin
      );
    } catch (error) {
      console.error("Token refresh error:", error);
      return jsonResponse(
        { error: "Internal server error" },
        500,
        origin
      );
    }
  }),
});

// POST /api/auth/mobile/revoke - Revoke a refresh token
http.route({
  path: "/api/auth/mobile/revoke",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    try {
      const body = await request.json();
      const { refreshToken } = body;

      if (!refreshToken) {
        return jsonResponse({ error: "Missing refresh token" }, 400, origin);
      }

      // Hash the refresh token
      const refreshTokenHash = await hashToken(refreshToken);
      const tokenRecord = await ctx.runQuery(
        internal.mobileAuth.validateRefreshToken,
        { refreshTokenHash }
      );

      if (!tokenRecord) {
        // Token doesn't exist or already revoked - still return success
        return jsonResponse({ success: true }, 200, origin);
      }

      // Revoke the token
      await ctx.runMutation(internal.mobileAuth.updateTokenLastUsed, {
        tokenId: tokenRecord._id,
      });

      // Actually revoke it
      await ctx.runMutation(internal.mobileAuth.revokeTokenInternal, {
        tokenId: tokenRecord._id,
      });

      return jsonResponse({ success: true }, 200, origin);
    } catch (error) {
      console.error("Token revocation error:", error);
      return jsonResponse(
        { error: "Internal server error" },
        500,
        origin
      );
    }
  }),
});

// POST /api/auth/mobile/verify - Verify an access token (for debugging/testing)
http.route({
  path: "/api/auth/mobile/verify",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/auth/mobile/verify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    try {
      // Get token from Authorization header
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return jsonResponse({ error: "Missing or invalid Authorization header" }, 401, origin);
      }

      const accessToken = authHeader.substring(7);

      // Get JWT secret
      const jwtSecret = await ctx.runQuery(internal.mobileAuth.getJwtSecret);

      // Verify the token
      const payload = await verifyJwt(accessToken, jwtSecret);

      if (!payload) {
        return jsonResponse({ error: "Invalid or expired token" }, 401, origin);
      }

      return jsonResponse(
        {
          valid: true,
          userId: payload.sub,
          email: payload.email,
          name: payload.name,
          expiresAt: (payload.exp as number) * 1000,
        },
        200,
        origin
      );
    } catch (error) {
      console.error("Token verification error:", error);
      return jsonResponse(
        { error: "Internal server error" },
        500,
        origin
      );
    }
  }),
});

export default http;

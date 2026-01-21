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
    "Access-Control-Allow-Credentials": "true",
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

// Simple test route
http.route({
  path: "/api/test",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// OPTIONS handler for CORS preflight
http.route({
  path: "/api/mobile/token",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/refresh",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/revoke",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

// POST /api/mobile/token - Exchange session for JWT tokens
// This endpoint requires an existing authenticated session (cookie-based)
http.route({
  path: "/api/mobile/token",
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
          iss: "carrel-mobile",
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

// POST /api/mobile/refresh - Refresh access token using refresh token
http.route({
  path: "/api/mobile/refresh",
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
          iss: "carrel-mobile",
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

// POST /api/mobile/revoke - Revoke a refresh token
http.route({
  path: "/api/mobile/revoke",
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

// Helper to verify mobile JWT and get user ID
async function verifyMobileAuth(
  ctx: { runQuery: (query: typeof internal.mobileAuth.getJwtSecret, args: Record<string, never>) => Promise<string> },
  request: Request
): Promise<{ userId: string; email: string; name?: string } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const accessToken = authHeader.substring(7);
  const jwtSecret = await ctx.runQuery(internal.mobileAuth.getJwtSecret, {});
  const payload = await verifyJwt(accessToken, jwtSecret);

  if (!payload) {
    return null;
  }

  return {
    userId: payload.sub as string,
    email: payload.email as string,
    name: payload.name as string | undefined,
  };
}

// GET /api/mobile/papers - List papers for authenticated mobile user
http.route({
  path: "/api/mobile/papers",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/papers",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    // Fetch papers for this user using internal query
    const papers = await ctx.runQuery(internal.papers.listForMobile, {
      userId: user.userId,
    });

    return jsonResponse(papers, 200, origin);
  }),
});

// GET /api/mobile/papers/:id - Get a single paper
http.route({
  path: "/api/mobile/paper",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/paper",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    const url = new URL(request.url);
    const paperId = url.searchParams.get("id");
    if (!paperId) {
      return jsonResponse({ error: "Missing paper ID" }, 400, origin);
    }

    const paper = await ctx.runQuery(internal.papers.getForMobile, {
      paperId,
      userId: user.userId,
    });

    if (!paper) {
      return jsonResponse({ error: "Paper not found" }, 404, origin);
    }

    return jsonResponse(paper, 200, origin);
  }),
});

// POST /api/mobile/paper/build - Trigger a paper build
http.route({
  path: "/api/mobile/paper/build",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/paper/build",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    const body = await request.json();
    const { paperId, force } = body;

    if (!paperId) {
      return jsonResponse({ error: "Missing paper ID" }, 400, origin);
    }

    try {
      await ctx.runAction(internal.sync.buildPaperForMobile, {
        paperId,
        userId: user.userId,
        force: force ?? false,
      });
      return jsonResponse({ success: true }, 200, origin);
    } catch (error) {
      console.error("Build error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Build failed" },
        500,
        origin
      );
    }
  }),
});

// POST /api/mobile/verify - Verify an access token (for debugging/testing)
http.route({
  path: "/api/mobile/verify",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/verify",
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

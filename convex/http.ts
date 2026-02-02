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
  // Only allow configured origins, or same-origin requests
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) allowedOrigins.push(siteUrl);
  // Always allow Capacitor mobile origins
  allowedOrigins.push("capacitor://localhost", "http://localhost");

  const allowedOrigin = origin && allowedOrigins.some(allowed => {
    try {
      const allowedHost = new URL(allowed).host;
      return origin === allowed || origin.endsWith(`.${allowedHost}`);
    } catch {
      return origin === allowed;
    }
  }) ? origin : null;

  return {
    "Access-Control-Allow-Origin": allowedOrigin || "",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

// OPTIONS handler for mobile email auth
http.route({
  path: "/api/mobile/auth/email",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

// POST /api/mobile/auth/email - Native email/password login for mobile apps
http.route({
  path: "/api/mobile/auth/email",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    try {
      const body = await request.json();
      const { email, password, deviceId, deviceName, platform } = body;

      if (!email || !password) {
        return jsonResponse({ error: "Email and password are required" }, 400, origin);
      }

      // Verify credentials using internal action
      const result = await ctx.runAction(internal.mobileEmailAuth.verifyEmailPassword, {
        email,
        password,
      });

      if (!result.success || !result.userId) {
        return jsonResponse({ error: result.error || "Invalid credentials" }, 401, origin);
      }

      // Get JWT secret
      const jwtSecret = await ctx.runQuery(internal.mobileAuth.getJwtSecret);

      // Get user details
      const user = await ctx.runQuery(internal.mobileAuth.getUserById, {
        userId: result.userId,
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
          sub: result.userId,
          email: user.email,
          name: user.name,
          iat: Math.floor(now / 1000),
          exp: Math.floor(accessTokenExpiry / 1000),
        },
        jwtSecret
      );

      // Store refresh token hash
      const refreshTokenHash = await hashToken(refreshToken);
      await ctx.runMutation(internal.mobileAuth.createMobileTokenRecord, {
        userId: result.userId,
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
      console.error("Email auth error:", error);
      return jsonResponse(
        { error: "Authentication failed" },
        500,
        origin
      );
    }
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
    console.log("[verifyMobileAuth] No Authorization header or wrong format");
    return null;
  }

  const accessToken = authHeader.substring(7);
  const jwtSecret = await ctx.runQuery(internal.mobileAuth.getJwtSecret, {});
  const payload = await verifyJwt(accessToken, jwtSecret);

  if (!payload) {
    console.log("[verifyMobileAuth] JWT verification failed - token:", accessToken.substring(0, 20) + "...");
    return null;
  }

  console.log("[verifyMobileAuth] Success - userId:", payload.sub);
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

// GET /api/mobile/user - Get authenticated user's profile
http.route({
  path: "/api/mobile/user",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/user",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    const profile = await ctx.runQuery(internal.users.getUserProfileForMobile, {
      userId: user.userId,
    });

    if (!profile) {
      return jsonResponse({ error: "User not found" }, 404, origin);
    }

    return jsonResponse(profile, 200, origin);
  }),
});

// DELETE /api/mobile/paper - Delete a paper
http.route({
  path: "/api/mobile/paper",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    try {
      const body = await request.json();
      const { paperId } = body;

      if (!paperId) {
        return jsonResponse({ error: "Missing paperId" }, 400, origin);
      }

      await ctx.runMutation(internal.papers.deletePaperForMobile, {
        paperId,
        userId: user.userId,
      });

      return jsonResponse({ success: true }, 200, origin);
    } catch (error) {
      console.error("Delete paper error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Delete failed" },
        500,
        origin
      );
    }
  }),
});

// PATCH /api/mobile/paper - Update paper metadata
http.route({
  path: "/api/mobile/paper",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    try {
      const body = await request.json();
      const { paperId, title, authors } = body;

      if (!paperId) {
        return jsonResponse({ error: "Missing paperId" }, 400, origin);
      }

      await ctx.runMutation(internal.papers.updatePaperForMobile, {
        paperId,
        userId: user.userId,
        title,
        authors,
      });

      return jsonResponse({ success: true }, 200, origin);
    } catch (error) {
      console.error("Update paper error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Update failed" },
        500,
        origin
      );
    }
  }),
});

// POST /api/mobile/paper/toggle-public - Toggle paper public/private
http.route({
  path: "/api/mobile/paper/toggle-public",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/paper/toggle-public",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    try {
      const body = await request.json();
      const { paperId } = body;

      if (!paperId) {
        return jsonResponse({ error: "Missing paperId" }, 400, origin);
      }

      const result = await ctx.runMutation(internal.papers.togglePublicForMobile, {
        paperId,
        userId: user.userId,
      });

      return jsonResponse(result, 200, origin);
    } catch (error) {
      console.error("Toggle public error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Toggle failed" },
        500,
        origin
      );
    }
  }),
});

// ==================== Repository Endpoints for Mobile ====================

// GET /api/mobile/repositories - List repositories for authenticated mobile user
http.route({
  path: "/api/mobile/repositories",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/repositories",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    const repositories = await ctx.runQuery(internal.repositories.listForMobile, {
      userId: user.userId,
    });

    return jsonResponse(repositories, 200, origin);
  }),
});

// POST /api/mobile/repository/refresh - Refresh a single repository
http.route({
  path: "/api/mobile/repository/refresh",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/repository/refresh",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    try {
      const body = await request.json();
      const { repositoryId } = body;

      if (!repositoryId) {
        return jsonResponse({ error: "Missing repositoryId" }, 400, origin);
      }

      const result = await ctx.runAction(internal.sync.refreshRepositoryInternal, {
        repositoryId,
        userId: user.userId,
      });

      return jsonResponse(result, 200, origin);
    } catch (error) {
      console.error("Repository refresh error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Refresh failed" },
        500,
        origin
      );
    }
  }),
});

// DELETE /api/mobile/repository - Delete a repository
http.route({
  path: "/api/mobile/repository",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/repository",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    try {
      const body = await request.json();
      const { repositoryId } = body;

      if (!repositoryId) {
        return jsonResponse({ error: "Missing repositoryId" }, 400, origin);
      }

      await ctx.runMutation(internal.repositories.removeForMobile, {
        repositoryId,
        userId: user.userId,
      });

      return jsonResponse({ success: true }, 200, origin);
    } catch (error) {
      console.error("Delete repository error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Delete failed" },
        500,
        origin
      );
    }
  }),
});

// POST /api/mobile/repositories/check-all - Check all repositories for updates
http.route({
  path: "/api/mobile/repositories/check-all",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/repositories/check-all",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    try {
      const result = await ctx.runAction(internal.sync.refreshAllRepositoriesForMobile, {
        userId: user.userId,
      });

      return jsonResponse(result, 200, origin);
    } catch (error) {
      console.error("Check all repositories error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Check failed" },
        500,
        origin
      );
    }
  }),
});

// GET /api/mobile/repository/files - List files in a repository
http.route({
  path: "/api/mobile/repository/files",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/repository/files",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    const url = new URL(request.url);
    const gitUrl = url.searchParams.get("gitUrl");
    const path = url.searchParams.get("path") || undefined;
    const branch = url.searchParams.get("branch") || undefined;

    if (!gitUrl) {
      return jsonResponse({ error: "Missing gitUrl" }, 400, origin);
    }

    try {
      const files = await ctx.runAction(internal.git.listRepositoryFilesInternal, {
        gitUrl,
        path,
        branch,
        userId: user.userId,
      });

      return jsonResponse(files, 200, origin);
    } catch (error) {
      console.error("List repository files error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Failed to list files" },
        500,
        origin
      );
    }
  }),
});

// GET /api/mobile/repository/tracked-files - List tracked files for a repository
http.route({
  path: "/api/mobile/repository/tracked-files",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/repository/tracked-files",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    const url = new URL(request.url);
    const repositoryId = url.searchParams.get("repositoryId");

    if (!repositoryId) {
      return jsonResponse({ error: "Missing repositoryId" }, 400, origin);
    }

    try {
      const trackedFiles = await ctx.runQuery(internal.repositories.listTrackedFilesForMobile, {
        repositoryId,
        userId: user.userId,
      });

      return jsonResponse(trackedFiles, 200, origin);
    } catch (error) {
      console.error("List tracked files error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Failed to list tracked files" },
        500,
        origin
      );
    }
  }),
});

// POST /api/mobile/repository/add-tracked-file - Add a tracked file to a repository
http.route({
  path: "/api/mobile/repository/add-tracked-file",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get("Origin")),
    });
  }),
});

http.route({
  path: "/api/mobile/repository/add-tracked-file",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");

    const user = await verifyMobileAuth(ctx, request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    try {
      const body = await request.json();
      const { repositoryId, filePath, title, pdfSourceType, compiler } = body;

      if (!repositoryId || !filePath || !title || !pdfSourceType) {
        return jsonResponse({ error: "Missing required fields" }, 400, origin);
      }

      const result = await ctx.runMutation(internal.repositories.addTrackedFileForMobile, {
        repositoryId,
        userId: user.userId,
        filePath,
        title,
        pdfSourceType,
        compiler,
      });

      return jsonResponse(result, 200, origin);
    } catch (error) {
      console.error("Add tracked file error:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Failed to add tracked file" },
        500,
        origin
      );
    }
  }),
});

// POST /api/compile-progress - Callback from latex service to update compilation progress
// This endpoint is called by the latex service during compilation
http.route({
  path: "/api/compile-progress",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Verify the request comes from our latex service using a shared secret
      const authHeader = request.headers.get("X-Compile-Secret");
      const expectedSecret = process.env.LATEX_COMPILE_SECRET;

      if (!expectedSecret || authHeader !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await request.json();
      const { paperId, progress } = body;

      if (!paperId) {
        return new Response(JSON.stringify({ error: "Missing paperId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Update the paper's compilation progress
      await ctx.runMutation(internal.papers.updateCompilationProgress, {
        paperId,
        progress: progress || null,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Compile progress callback error:", error);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

export default http;

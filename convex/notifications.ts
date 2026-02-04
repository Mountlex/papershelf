import { v } from "convex/values";
import { mutation, query, internalAction, action, internalQuery, internalMutation } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_PREFERENCES = {
  enabled: true,
  buildSuccess: true,
  buildFailure: true,
  paperUpdated: true,
  backgroundSync: true,
};

type NotificationPreferences = typeof DEFAULT_PREFERENCES;
type NotificationCtx = ActionCtx;

// Register or update a device token for push notifications
export const registerDeviceToken = mutation({
  args: {
    token: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
    environment: v.optional(v.union(v.literal("production"), v.literal("sandbox"))),
    deviceId: v.optional(v.string()),
    appVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("deviceTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        platform: args.platform,
        environment: args.environment,
        deviceId: args.deviceId,
        appVersion: args.appVersion,
        lastSeenAt: now,
      });
      return { updated: true };
    }

    await ctx.db.insert("deviceTokens", {
      userId,
      token: args.token,
      platform: args.platform,
      environment: args.environment,
      deviceId: args.deviceId,
      appVersion: args.appVersion,
      createdAt: now,
      lastSeenAt: now,
    });
    return { created: true };
  },
});

// Remove a device token (e.g., logout or user disables notifications)
export const unregisterDeviceToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("deviceTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
      return { deleted: true };
    }
    return { deleted: false };
  },
});

export const getNotificationPreferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (!existing) {
      return DEFAULT_PREFERENCES;
    }

    return {
      enabled: existing.enabled,
      buildSuccess: existing.buildSuccess,
      buildFailure: existing.buildFailure,
      paperUpdated: existing.paperUpdated,
      backgroundSync: existing.backgroundSync,
    };
  },
});

export const updateNotificationPreferences = mutation({
  args: {
    enabled: v.boolean(),
    buildSuccess: v.boolean(),
    buildFailure: v.boolean(),
    paperUpdated: v.boolean(),
    backgroundSync: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
    } else {
      await ctx.db.insert("notificationPreferences", {
        userId,
        ...args,
        updatedAt: now,
      });
    }
    return { success: true };
  },
});

export const getPreferencesForUserInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (!existing) return DEFAULT_PREFERENCES;

    return {
      enabled: existing.enabled,
      buildSuccess: existing.buildSuccess,
      buildFailure: existing.buildFailure,
      paperUpdated: existing.paperUpdated,
      backgroundSync: existing.backgroundSync,
    };
  },
});

export const listDeviceTokensForUserInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("deviceTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const deleteDeviceTokenInternal = internalMutation({
  args: {
    tokenId: v.id("deviceTokens"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.tokenId);
  },
});

export const getPaperNotificationInfoInternal = internalQuery({
  args: {
    paperId: v.id("papers"),
  },
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;

    if (paper.repositoryId) {
      const repo = await ctx.db.get(paper.repositoryId);
      return {
        userId: repo?.userId ?? null,
        title: paper.title ?? null,
      };
    }

    return {
      userId: paper.userId ?? null,
      title: paper.title ?? null,
    };
  },
});

export const getPaperForStatusInternal = internalQuery({
  args: {
    paperId: v.id("papers"),
  },
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;
    return {
      currentBuildAttemptId: paper.currentBuildAttemptId ?? null,
      buildStatus: paper.buildStatus ?? null,
    };
  },
});

export const sendTestNotification = action({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const preferences = await getPreferencesForUser(ctx, userId);
    if (!preferences.enabled) {
      return { delivered: 0, reason: "disabled" };
    }

    return sendPushToUser(ctx, userId, {
      pushType: "alert",
      title: "Test notification",
      body: "Notifications are working.",
      data: {
        event: "test_notification",
      },
      collapseId: `test-${userId}`,
      includeBackground: preferences.backgroundSync,
    });
  },
});

export const notifyBuildCompleted = internalAction({
  args: {
    paperId: v.id("papers"),
    status: v.union(v.literal("success"), v.literal("failure")),
    error: v.optional(v.string()),
    attemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const info = await ctx.runQuery(internal.notifications.getPaperNotificationInfoInternal, {
      paperId: args.paperId,
    });
    if (!info?.userId) return { delivered: 0 };

    if (args.status === "failure" && args.attemptId) {
      const paper = await ctx.runQuery(internal.notifications.getPaperForStatusInternal, {
        paperId: args.paperId,
      });
      if (!paper) return { delivered: 0 };
      if (paper.currentBuildAttemptId !== args.attemptId) {
        return { delivered: 0, reason: "superseded" };
      }
      if (paper.buildStatus !== "error") {
        return { delivered: 0, reason: "not_error" };
      }
    }

    const preferences = await getPreferencesForUser(ctx, info.userId);
    if (!preferences.enabled) return { delivered: 0 };
    if (args.status === "success" && !preferences.buildSuccess) return { delivered: 0 };
    if (args.status === "failure" && !preferences.buildFailure) return { delivered: 0 };

    const title = args.status === "success" ? "Build completed" : "Build failed";
    const paperTitle = info.title || "Paper";
    const body = args.status === "success"
      ? `${paperTitle} is ready.`
      : `${paperTitle} failed to build.`;

    return sendPushToUser(ctx, info.userId, {
      pushType: "alert",
      title,
      body,
      data: {
        event: "build_completed",
        status: args.status,
        paperId: args.paperId,
        error: args.error,
      },
      collapseId: `build-${args.paperId}`,
      includeBackground: preferences.backgroundSync,
    });
  },
});

export const notifyPaperUpdated = internalAction({
  args: {
    paperId: v.id("papers"),
  },
  handler: async (ctx, args) => {
    const info = await ctx.runQuery(internal.notifications.getPaperNotificationInfoInternal, {
      paperId: args.paperId,
    });
    if (!info?.userId) return { delivered: 0 };

    const preferences = await getPreferencesForUser(ctx, info.userId);
    if (!preferences.enabled || !preferences.paperUpdated) return { delivered: 0 };

    const paperTitle = info.title || "Paper";
    return sendPushToUser(ctx, info.userId, {
      pushType: "alert",
      title: "Paper updated",
      body: `${paperTitle} has new changes.`,
      data: {
        event: "paper_updated",
        paperId: args.paperId,
      },
      collapseId: `update-${args.paperId}`,
      includeBackground: preferences.backgroundSync,
    });
  },
});

async function getPreferencesForUser(
  ctx: NotificationCtx,
  userId: Id<"users">
): Promise<NotificationPreferences> {
  return await ctx.runQuery(internal.notifications.getPreferencesForUserInternal, {
    userId,
  });
}

type PushPayload = {
  pushType: "alert" | "background";
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  collapseId?: string;
  includeBackground?: boolean;
};

async function sendPushToUser(
  ctx: NotificationCtx,
  userId: Id<"users">,
  payload: PushPayload
): Promise<{ delivered: number }> {
  const tokens = await ctx.runQuery(internal.notifications.listDeviceTokensForUserInternal, {
    userId,
  });

  if (!tokens.length) return { delivered: 0 };

  let delivered = 0;

  for (const token of tokens) {
    const config = getApnsConfig(token.environment);
    if (!config) {
      console.log("APNs config missing; skipping push");
      continue;
    }

    const jwt = await createApnsJwt(config);
    const result = await sendApnsRequest({
      jwt,
      token: token.token,
      topic: config.topic,
      env: config.env,
      payload,
    });

    if (result.status === 200) {
      delivered += 1;
    } else if (result.status === 410) {
      await ctx.runMutation(internal.notifications.deleteDeviceTokenInternal, {
        tokenId: token._id,
      });
    }
  }

  return { delivered };
}

type ApnsConfig = {
  keyId: string;
  teamId: string;
  topic: string;
  privateKey: string;
  env: "production" | "sandbox";
};

function getApnsConfig(overrideEnv?: "production" | "sandbox" | null): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const topic = process.env.APNS_TOPIC;
  const privateKey = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !topic || !privateKey) {
    return null;
  }
  const env = overrideEnv ?? (process.env.APNS_ENV === "sandbox" ? "sandbox" : "production");
  return { keyId, teamId, topic, privateKey, env };
}

async function createApnsJwt(config: ApnsConfig): Promise<string> {
  const header = {
    alg: "ES256",
    kid: config.keyId,
  };
  const payload = {
    iss: config.teamId,
    iat: Math.floor(Date.now() / 1000),
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;

  const keyData = pemToArrayBuffer(config.privateKey);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(message)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${message}.${signatureB64}`;
}

type ApnsRequestArgs = {
  jwt: string;
  token: string;
  topic: string;
  env: "production" | "sandbox";
  payload: PushPayload;
};

async function sendApnsRequest(args: ApnsRequestArgs): Promise<{ status: number }> {
  const host = args.env === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  const url = `${host}/3/device/${args.token}`;

  const aps: Record<string, unknown> = {};
  if (args.payload.pushType === "alert") {
    aps.alert = { title: args.payload.title, body: args.payload.body };
    aps.sound = "default";
  }
  if (args.payload.includeBackground) {
    aps["content-available"] = 1;
  }

  const body = JSON.stringify({
    aps,
    ...args.payload.data ? { data: args.payload.data } : {},
  });

  const headers: Record<string, string> = {
    authorization: `bearer ${args.jwt}`,
    "apns-topic": args.topic,
    "apns-push-type": args.payload.pushType,
    "apns-priority": args.payload.pushType === "background" ? "5" : "10",
  };
  if (args.payload.collapseId) {
    headers["apns-collapse-id"] = args.payload.collapseId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (response.status !== 200) {
    const text = await response.text();
    console.log(`APNs error (${response.status}): ${text}`);
  }

  return { status: response.status };
}

function pemToArrayBuffer(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return base64ToBytes(cleaned);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  return base64UrlEncodeBytes(bytes);
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return globalThis.btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

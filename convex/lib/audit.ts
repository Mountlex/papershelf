import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

type AuditAction =
  | "account_merge"
  | "provider_link"
  | "password_reset"
  | "session_invalidate"
  | "token_revoke";

interface AuditLogParams {
  userId: Id<"users">;
  action: AuditAction;
  targetUserId?: Id<"users">;
  metadata?: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
}

export async function logAudit(
  ctx: MutationCtx,
  params: AuditLogParams
): Promise<Id<"auditLogs">> {
  return await ctx.db.insert("auditLogs", {
    userId: params.userId,
    action: params.action,
    targetUserId: params.targetUserId,
    metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    timestamp: Date.now(),
    success: params.success,
    errorMessage: params.errorMessage,
  });
}

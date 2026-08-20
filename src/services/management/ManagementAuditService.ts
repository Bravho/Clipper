/**
 * Audit trail for RClipper Management.
 *
 * Every financial and publishing action is recorded here with correlation ids,
 * so a support question ("why does this user have access until March?") can be
 * answered from the database rather than from server logs.
 *
 * SAFE METADATA ONLY. Never pass an API key, a webhook secret, a social token,
 * an authorization code, or a raw provider payload into `metadata` — the audit
 * table is queried by staff tooling and must stay free of credentials.
 *
 * Writing an audit row must never break the action it describes: a failure here
 * is logged and swallowed. Losing an audit line is bad; failing a paid transfer
 * because the audit insert hit a constraint is worse.
 */

import { pool } from "@/lib/db";

export type ManagementAuditEvent =
  | "management.payment.created"
  | "management.payment.verified"
  | "management.payment.failed"
  | "management.access.activated"
  | "management.access.extended"
  | "management.access.expired"
  | "management.access.revoked"
  /** A permanent single-video publish unlock was granted. */
  | "management.publish_unlock.activated"
  | "management.publish_unlock.revoked"
  /** A consumable upload-token bundle (the entry product) was granted. */
  | "management.upload_bundle.granted"
  /** Free, optional collection of content. */
  | "management.transfer.started"
  | "management.transfer.completed"
  | "management.transfer.failed"
  | "management.upload.started"
  | "management.upload.completed"
  | "management.upload.failed"
  /** A paying user's uploads were moved to the longer (30-day) retention prefix. */
  | "management.upload.retention_extended"
  /** A paying user's TRANSFERRED generation clips were promoted to that prefix. */
  | "management.transfer.retention_extended"
  /** Media retention. */
  | "management.media.expired"
  | "management.social_account.connected"
  | "management.social_account.disconnected"
  | "management.publication.created"
  | "management.publication.scheduled"
  | "management.publication.publishing"
  | "management.publication.published"
  | "management.publication.partially_published"
  | "management.publication.failed"
  /** A still-scheduled post's copy was edited before it fired. */
  | "management.publication.edited"
  /** A still-scheduled post was cancelled at the provider before it fired. */
  | "management.publication.cancelled";

export interface ManagementAuditContext {
  userId?: string | null;
  purchaseId?: string | null;
  accessPassId?: string | null;
  publishEntitlementId?: string | null;
  sourceGenerationId?: string | null;
  managementContentId?: string | null;
  publicationId?: string | null;
  providerPostId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Keys that must never be persisted, even if a caller passes them by mistake. */
const FORBIDDEN_METADATA_KEYS = [
  "apikey",
  "api_key",
  "authorization",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "code",
];

function scrubMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!metadata) return null;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.some((f) => lower.includes(f))) {
      safe[key] = "[redacted]";
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export class ManagementAuditService {
  constructor(private db = pool) {}

  async record(
    event: ManagementAuditEvent,
    context: ManagementAuditContext = {}
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO management_audit_events
           (event, user_id, purchase_id, access_pass_id, publish_entitlement_id,
            source_generation_id, management_content_id, publication_id,
            provider_post_id, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          event,
          context.userId ?? null,
          context.purchaseId ?? null,
          context.accessPassId ?? null,
          context.publishEntitlementId ?? null,
          context.sourceGenerationId ?? null,
          context.managementContentId ?? null,
          context.publicationId ?? null,
          context.providerPostId ?? null,
          scrubMetadata(context.metadata),
        ]
      );
    } catch (err) {
      // Never let auditing break the operation it is describing.
      console.error(`[management audit] failed to record ${event}:`, err);
    }
  }
}

export const managementAuditService = new ManagementAuditService();

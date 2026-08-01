import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  socialPublishingProvider,
  POST_FOR_ME_PROVIDER_KEY,
} from "@/services/social-publishing";
import { managementJobRepository } from "@/repositories";
import { ManagementJobKind } from "@/domain/enums/ManagementStatus";

export const dynamic = "force-dynamic";

/**
 * POST /api/management/postwebhooks
 *
 * Inbound Post for Me webhook. Registered via `POST /v1/webhooks`; the secret it
 * returned is `POST_FOR_ME_WEBHOOK_SECRET`, matched against the
 * `Post-For-Me-Webhook-Secret` header on every delivery.
 *
 * CONTRACT (from the provider):
 *   * We must return 2XX within ~1 second, or delivery is treated as failed and
 *     retried (~8 times over 24h). So this route does the MINIMUM synchronously —
 *     verify, dedupe, enqueue — and lets the management worker reconcile
 *     asynchronously.
 *   * Deliveries repeat, so handling must be idempotent. `management_webhook_events`
 *     has a UNIQUE (provider, provider_event_id); a conflict means "already seen".
 *
 * THE PAYLOAD IS NEVER TRUSTED. It only tells us WHICH publication changed (via
 * the `external_id` we set on `createPost`); the authoritative per-destination
 * result is re-fetched from the provider by the reconcile job, never read from
 * the webhook body.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  // Verify the shared secret and parse. Null = not authentic / not parseable.
  const event = socialPublishingProvider.verifyAndParseWebhook(
    request.headers,
    rawBody
  );
  if (!event) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Record for dedupe first. A unique violation (no row returned) means this
  // exact delivery was already handled — acknowledge and stop.
  let recordedId: string | null = null;
  try {
    const recorded = await pool.query<{ id: string }>(
      `INSERT INTO management_webhook_events
         (provider, provider_event_id, event_type, payload)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [POST_FOR_ME_PROVIDER_KEY, event.id, event.type, JSON.stringify(event.payload)]
    );
    recordedId = recorded.rows[0]?.id ?? null;
  } catch (err) {
    console.error("[post-for-me webhook] failed to record event", err);
    // Ask the provider to retry rather than silently dropping the event.
    return NextResponse.json({ error: "Temporary error." }, { status: 500 });
  }

  if (!recordedId) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Post events carry our publication id in external_id. Enqueue a reconcile so
  // the worker pulls the real status. Account events are recorded but need no
  // reconcile here.
  const publicationId = event.type.startsWith("social.post")
    ? extractPublicationId(event.payload)
    : null;

  if (publicationId) {
    try {
      await managementJobRepository.enqueue({
        kind: ManagementJobKind.ReconcilePublication,
        // Event-scoped so a later, distinct event can still trigger a fresh
        // reconcile even after an earlier reconcile job completed. Redeliveries
        // of THIS event never reach here (caught by the dedupe row above).
        dedupeKey: `reconcile:webhook:${event.id}`,
        payload: { publicationId },
        runAfter: new Date(),
      });
    } catch (err) {
      console.error("[post-for-me webhook] failed to enqueue reconcile", err);
      // Undo the dedupe row so a retry re-processes rather than being skipped.
      await pool
        .query("DELETE FROM management_webhook_events WHERE id = $1", [recordedId])
        .catch(() => undefined);
      return NextResponse.json({ error: "Temporary error." }, { status: 500 });
    }
  }

  await pool
    .query("UPDATE management_webhook_events SET processed_at = NOW() WHERE id = $1", [
      recordedId,
    ])
    .catch(() => undefined);

  return NextResponse.json({ ok: true });
}

/**
 * Pull OUR publication id (the `external_id` set on createPost) out of a post
 * event payload. Defensive about shape: the id may sit on the event's `data`
 * object directly, or on a nested post/result object. Returns null when absent —
 * in which case the publish-time reconcile job (which polls until terminal)
 * still catches the result; the webhook is only an accelerator.
 */
function extractPublicationId(payload: Record<string, unknown>): string | null {
  const readExternalId = (obj: unknown): string | null => {
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    for (const key of ["external_id", "externalId"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };

  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;

  return (
    readExternalId(data) ??
    readExternalId((data as Record<string, unknown>).post) ??
    readExternalId((data as Record<string, unknown>).social_post) ??
    readExternalId((data as Record<string, unknown>).result) ??
    readExternalId(payload)
  );
}

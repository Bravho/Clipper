/**
 * Post for Me — inbound webhook verification.
 *
 * VERIFICATION IS A SHARED SECRET, NOT AN HMAC. Every delivery carries the
 * header `Post-For-Me-Webhook-Secret`, whose value must equal the secret
 * returned when the webhook was created via `POST /v1/webhooks`.
 *
 * That is materially weaker than a Stripe-style signature: the payload is not
 * signed, so it carries no proof of integrity, and there is no timestamp, so a
 * captured request can be replayed forever. Two consequences that callers must
 * respect:
 *
 *   1. Compare in CONSTANT TIME. A naive `===` on a secret leaks it byte by byte
 *      to an attacker who can measure response timing.
 *   2. Treat the body as UNTRUSTED INPUT even after it verifies. Anyone who ever
 *      learns the secret can post arbitrary JSON. The webhook is a hint that
 *      something changed — the authoritative state is re-fetched from the API,
 *      exactly as `PaymentService.settleFromWebhook` re-verifies with Stripe
 *      rather than believing the event.
 *
 * Replay protection is ours to provide: `management_webhook_events` has a unique
 * constraint on (provider, provider_event_id).
 */

import { createHash, timingSafeEqual } from "crypto";
import { POST_FOR_ME_CONFIG } from "@/config/management";
import type { SocialWebhookEvent, SocialWebhookEventType } from "../types";

export const POST_FOR_ME_WEBHOOK_SECRET_HEADER = "post-for-me-webhook-secret";

const KNOWN_EVENT_TYPES: readonly SocialWebhookEventType[] = [
  "social.post.created",
  "social.post.updated",
  "social.post.deleted",
  "social.post.result.created",
  "social.account.created",
  "social.account.updated",
];

/** Length-safe constant-time comparison. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself be a timing
  // signal, so compare a fixed-size digest-like padding instead: equal lengths
  // are required, and we return false without branching on content.
  if (a.length !== b.length) {
    // Still burn a comparison so the failure path is not measurably faster.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Verify a delivery and parse it.
 *
 * Returns null for anything not authentic or not parseable — the route then
 * rejects without needing to know how verification works.
 */
export function verifyAndParseWebhook(
  headers: Headers,
  rawBody: string
): SocialWebhookEvent | null {
  const expected = POST_FOR_ME_CONFIG.webhookSecret;
  if (!expected) {
    console.error(
      "[post-for-me webhook] rejected: POST_FOR_ME_WEBHOOK_SECRET is not configured."
    );
    return null;
  }

  const provided = headers.get(POST_FOR_ME_WEBHOOK_SECRET_HEADER);
  if (!provided || !secretMatches(provided, expected)) {
    // Never log the provided value — it may be a near-miss of the real secret.
    console.error("[post-for-me webhook] rejected: secret mismatch.");
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.error("[post-for-me webhook] rejected: body is not valid JSON.");
    return null;
  }

  const type = readEventType(payload);
  const id = readEventId(payload, rawBody);

  return { id, type, payload };
}

function readEventType(payload: Record<string, unknown>): SocialWebhookEventType {
  for (const key of ["type", "event", "event_type"]) {
    const value = payload[key];
    if (typeof value === "string" && KNOWN_EVENT_TYPES.includes(value as SocialWebhookEventType)) {
      return value as SocialWebhookEventType;
    }
  }
  // An unrecognised type is stored and acknowledged rather than rejected: the
  // provider may add events, and returning non-2xx would make it retry
  // something we are deliberately ignoring.
  return "unknown";
}

/**
 * A stable id for deduplication.
 *
 * The provider does not document a guaranteed event-id field, so if none of the
 * likely candidates is present we fall back to a hash of the body. That is
 * sound for dedupe: a redelivery of the SAME event has an identical body and
 * therefore an identical hash, while a genuinely new event differs.
 */
function readEventId(payload: Record<string, unknown>, rawBody: string): string {
  for (const key of ["id", "event_id", "eventId", "delivery_id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const data = payload.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inner = (data as Record<string, unknown>).id;
    const type = readEventType(payload);
    // Scope by type so, e.g., created and updated for one post are distinct.
    if (typeof inner === "string" && inner.trim()) return `${type}:${inner}`;
  }

  return `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
}

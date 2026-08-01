import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { socialPublishingProvider } from "@/services/social-publishing";

// Node runtime: verification reads the RAW body and uses node:crypto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/post-for-me
 *
 * THE ONE-SECOND BUDGET IS THE DESIGN CONSTRAINT. The provider expects a 2XX
 * within one second and otherwise treats the delivery as failed, retrying ~8
 * times over 24 hours. So this route does the minimum: verify, record, enqueue,
 * acknowledge. No provider calls, no status recomputation, no email — all of
 * that belongs to the job runner reading `management_jobs`.
 *
 * DUPLICATES ARE EXPECTED, NOT EXCEPTIONAL. Redeliveries are normal, so the
 * insert into `management_webhook_events` carries a unique constraint on
 * (provider, provider_event_id); a conflict means "already handled" and is
 * answered 200 rather than treated as an error.
 *
 * THE PAYLOAD IS A HINT, NOT DATA. Verification is a shared secret with no
 * signature over the body and no timestamp, so anyone who learns the secret can
 * post arbitrary JSON. Nothing here writes business state from the payload; the
 * job re-fetches the authoritative record from the API — the same discipline
 * `PaymentService.settleFromWebhook` applies to Stripe.
 */
export async function POST(request: Request) {
  // Raw text, before any parsing: verification must see exactly what was sent.
  const rawBody = await request.text();

  const event = socialPublishingProvider.verifyAndParseWebhook(
    request.headers,
    rawBody
  );
  if (!event) {
    // Deliberately terse. A verbose rejection helps an attacker probe the secret.
    return NextResponse.json({ error: "Invalid webhook." }, { status: 401 });
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO management_webhook_events
         (provider, provider_event_id, event_type, payload)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [
        socialPublishingProvider.key,
        event.id,
        event.type,
        // Stored for audit and replay. Never rendered to a user.
        JSON.stringify(event.payload),
      ]
    );

    // Already seen — acknowledge so the provider stops retrying.
    if (!inserted.rows[0]) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Events we do not act on are still recorded, then acknowledged. Returning
    // non-2xx would make the provider retry something we are ignoring on purpose.
    if (event.type === "unknown") {
      return NextResponse.json({ received: true, ignored: true });
    }

    // Enqueue the real work. `dedupe_key` is UNIQUE, so a redelivery that races
    // past the check above still cannot create a second job.
    await pool.query(
      `INSERT INTO management_jobs (kind, dedupe_key, payload)
       VALUES ($1,$2,$3)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        "process_provider_webhook",
        `webhook:${socialPublishingProvider.key}:${event.id}`,
        JSON.stringify({ eventId: event.id, eventType: event.type }),
      ]
    );

    return NextResponse.json({ received: true });
  } catch (err) {
    // A 500 makes the provider retry, which is what we want if OUR storage
    // failed — the event is not lost.
    console.error("[POST /api/webhooks/post-for-me]", err);
    return NextResponse.json({ error: "Could not record event." }, { status: 500 });
  }
}

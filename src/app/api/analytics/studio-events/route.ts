import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/helpers";
import { STUDIO_EVENT_BATCH_MAX } from "@/config/studioEvents";
import { studioEventService } from "@/services/analytics/StudioEventService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A batch of 50 small events is a few KB; anything far larger is not ours. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * POST /api/analytics/studio-events
 *
 * The studio's behaviour events, in batches (src/features/device-render/
 * studioTracker.ts). Accepts JSON or the text/plain body `navigator.sendBeacon`
 * sends when the app goes to the background. Always answers 204 for a signed-in
 * user — the phone never retries and never shows an error for analytics.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let events: unknown[] = [];
  try {
    const text = await request.text();
    if (text.length <= MAX_BODY_BYTES) {
      const body = JSON.parse(text) as { events?: unknown };
      if (Array.isArray(body.events)) events = body.events.slice(0, STUDIO_EVENT_BATCH_MAX);
    }
  } catch {
    events = [];
  }

  if (events.length > 0) {
    await studioEventService.record({
      userId: user.id,
      events,
      userAgent: request.headers.get("user-agent"),
    });
  }
  return new NextResponse(null, { status: 204 });
}

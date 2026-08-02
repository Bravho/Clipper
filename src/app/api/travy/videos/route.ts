/**
 * GET /api/travy/videos
 *
 * Server-to-server feed consumed by the Travy admin "รีวิว RClipper วีดิโอ"
 * page. Authenticated with the shared `RCLIPPER_API_KEY` secret via the
 * `X-API-Key` header — not a NextAuth session, because the caller is Travy's
 * Express backend, not a browser.
 *
 * Note the direction: this is Travy READING FROM RClipper. It is unrelated to
 * `src/lib/social/travyService.ts`, which POSTs to Travy's own `/api/videos`
 * when publishing. Same path name, opposite direction, different servers.
 *
 * Query params: page (1-based), limit (default 10, max 50), status
 * ("available" | "deleted"), project (accepted and ignored — RClipper serves
 * exactly one Travy feed).
 *
 * Read-only. No schema changes, no writes.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTravyApiKey } from "../_guard";
import { listTravyVideos, MAX_LIMIT } from "@/services/TravyVideoFeedService";

// Presigned URLs and live Spaces checks must never be cached by Next.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const guard = requireTravyApiKey(request);
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10)
    );
    const status = searchParams.get("status") ?? undefined;

    const result = await listTravyVideos({ page, limit, status });

    return NextResponse.json(result, {
      headers: {
        // Presigned URLs expire; make sure nothing between us and Travy caches them.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("[api/travy/videos]", err);
    return NextResponse.json(
      { error: "Failed to list Travy videos." },
      { status: 500 }
    );
  }
}

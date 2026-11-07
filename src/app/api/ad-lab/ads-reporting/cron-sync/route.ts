export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { syncAdsReporting } from "@/services/ad-lab/ads-reporting/adsReportingService";
import crypto from "crypto";

/** Constant-time string comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still run the compare to preserve constant-time behaviour
    crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(a, "utf8"));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export async function POST(request: Request) {
  const secret = (process.env.ADS_REPORTING_CRON_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Cron sync is not configured." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!safeEqual(secret, provided)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const ownerIds = (process.env.ADS_REPORTING_SYNC_OWNER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ownerIds.length) {
    return NextResponse.json({ ok: true, message: "No owners configured.", synced: [] });
  }

  // Re-pull last 3 days to catch late attribution
  const results: Array<{ ownerId: string; results: unknown; error?: string }> = [];
  for (const ownerId of ownerIds) {
    try {
      const syncResults = await syncAdsReporting(ownerId, { days: 3 });
      results.push({ ownerId, results: syncResults });
    } catch (err) {
      console.error(`[cron-sync] ownerId=${ownerId}`, err);
      results.push({ ownerId, results: [], error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: true, synced: results });
}

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { startTikTokConnect, oauthConfigError } from "@/services/ad-lab/ads-reporting/adsReportingService";

export async function GET(request: Request) {
  const auth = await requireAdLabUser();
  if (!auth.ok) return auth.response;

  // Never redirect to the provider with an empty/undefined app id.
  const configError = oauthConfigError("tiktok", "connect");
  if (configError) {
    return NextResponse.json({ error: configError, reason: "oauth_not_configured" }, { status: 400 });
  }
  // Preflight used by the UI before navigating: no state is created.
  if (new URL(request.url).searchParams.get("check") === "1") {
    return NextResponse.json({ ok: true });
  }

  try {
    const authUrl = await startTikTokConnect(auth.user.id);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("[GET /api/ad-lab/ads-reporting/tiktok/connect]", err);
    return NextResponse.json({ error: "ไม่สามารถเริ่มการเชื่อมต่อ TikTok ได้" }, { status: 503 });
  }
}

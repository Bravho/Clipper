export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { completeTikTokConnect, oauthConfigError } from "@/services/ad-lab/ads-reporting/adsReportingService";

export async function GET(request: NextRequest) {
  const auth = await requireAdLabUser();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const authCode = searchParams.get("auth_code") ?? "";
  const state = searchParams.get("state") ?? "";

  if (!authCode || !state) {
    return NextResponse.redirect(
      new URL("/dashboard/ad-lab/analyze?ads_error=tiktok_missing_params", request.url),
    );
  }

  const configError = oauthConfigError("tiktok", "callback");
  if (configError) {
    return NextResponse.redirect(
      new URL(`/dashboard/ad-lab/analyze?ads_error=tiktok_oauth_not_configured&detail=${encodeURIComponent(configError)}`, request.url),
    );
  }

  try {
    await completeTikTokConnect(auth.user.id, authCode, state);
    return NextResponse.redirect(
      new URL("/dashboard/ad-lab/analyze?ads=tiktok_connected", request.url),
    );
  } catch (err) {
    console.error("[GET /api/ad-lab/ads-reporting/tiktok/callback]", err);
    const msg = err instanceof Error ? encodeURIComponent(err.message) : "unknown";
    return NextResponse.redirect(
      new URL(`/dashboard/ad-lab/analyze?ads_error=tiktok_callback_failed&detail=${msg}`, request.url),
    );
  }
}

export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { completeMetaConnect, oauthConfigError } from "@/services/ad-lab/ads-reporting/adsReportingService";

export async function GET(request: NextRequest) {
  const auth = await requireAdLabUser();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code") ?? "";
  const state = searchParams.get("state") ?? "";

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/dashboard/ad-lab/analyze?ads_error=meta_missing_params", request.url),
    );
  }

  const configError = oauthConfigError("meta", "callback");
  if (configError) {
    return NextResponse.redirect(
      new URL(`/dashboard/ad-lab/analyze?ads_error=meta_oauth_not_configured&detail=${encodeURIComponent(configError)}`, request.url),
    );
  }

  try {
    await completeMetaConnect(auth.user.id, code, state);
    return NextResponse.redirect(
      new URL("/dashboard/ad-lab/analyze?ads=meta_connected", request.url),
    );
  } catch (err) {
    console.error("[GET /api/ad-lab/ads-reporting/meta/callback]", err);
    const msg = err instanceof Error ? encodeURIComponent(err.message) : "unknown";
    return NextResponse.redirect(
      new URL(`/dashboard/ad-lab/analyze?ads_error=meta_callback_failed&detail=${msg}`, request.url),
    );
  }
}

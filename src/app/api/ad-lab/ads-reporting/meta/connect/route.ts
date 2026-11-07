export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { startMetaConnect, oauthConfigError, META_SYSTEM_USER_LABEL } from "@/services/ad-lab/ads-reporting/adsReportingService";
import { isMetaSystemUserConfigured } from "@/services/ad-lab/ads-reporting/metaAdsClient";

export async function GET(request: Request) {
  const auth = await requireAdLabUser();
  if (!auth.ok) return auth.response;

  // System user (env token + account ids) is already connected; OAuth isn't needed.
  if (isMetaSystemUserConfigured()) {
    return NextResponse.json(
      { error: `Meta เชื่อมต่อผ่าน System User (${META_SYSTEM_USER_LABEL}) แล้ว ไม่ต้องเชื่อมต่อผ่าน OAuth`, reason: "system_user_connected" },
      { status: 409 },
    );
  }
  // Never redirect to the provider with an empty/undefined app id.
  const configError = oauthConfigError("meta", "connect");
  if (configError) {
    return NextResponse.json({ error: configError, reason: "oauth_not_configured" }, { status: 400 });
  }
  // Preflight used by the UI before navigating: no state is created.
  if (new URL(request.url).searchParams.get("check") === "1") {
    return NextResponse.json({ ok: true });
  }

  try {
    const authUrl = await startMetaConnect(auth.user.id);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("[GET /api/ad-lab/ads-reporting/meta/connect]", err);
    return NextResponse.json({ error: "ไม่สามารถเริ่มการเชื่อมต่อ Meta ได้" }, { status: 503 });
  }
}

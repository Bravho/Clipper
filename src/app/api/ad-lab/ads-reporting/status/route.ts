export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { getAdsReportingStatus, getTikTokEnvNames, getMetaEnvNames } from "@/services/ad-lab/ads-reporting/adsReportingService";
import { isTikTokConfigured } from "@/services/ad-lab/ads-reporting/tiktokAdsClient";
import { isMetaConfigured } from "@/services/ad-lab/ads-reporting/metaAdsClient";

export async function GET() {
  const auth = await requireAdLabUser();
  if (!auth.ok) return auth.response;

  try {
    const statuses = await getAdsReportingStatus(auth.user.id);
    return NextResponse.json({
      platforms: statuses,
      envNames: {
        tiktok: isTikTokConfigured() ? [] : getTikTokEnvNames(),
        meta: isMetaConfigured() ? [] : getMetaEnvNames(),
      },
    });
  } catch (err) {
    console.error("[GET /api/ad-lab/ads-reporting/status]", err);
    return NextResponse.json({ error: "ไม่สามารถโหลดสถานะได้" }, { status: 503 });
  }
}

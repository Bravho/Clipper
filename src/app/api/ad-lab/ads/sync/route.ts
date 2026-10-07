import { NextResponse } from "next/server";
import { z } from "zod";
import { adLabErrorResponse, requireAdLabUser } from "../../_guard";
import { AdLabAdsError, adLabAdsService } from "@/services/ad-lab/AdLabAdsService";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ targetId: z.string().uuid() });

/** POST /api/ad-lab/ads/sync — pull Ads Manager reporting into spend (read-only). */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sync request." }, { status: 400 });
  try {
    const publication = await adLabAdsService.syncReport(guard.user.id, parsed.data.targetId);
    return NextResponse.json({ publication });
  } catch (err) {
    if (err instanceof AdLabAdsError) {
      return NextResponse.json({ error: err.message, reason: err.code }, { status: err.code === "not_found" ? 404 : 502 });
    }
    return adLabErrorResponse("POST /api/ad-lab/ads/sync", err);
  }
}

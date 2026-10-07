import { NextResponse } from "next/server";
import { z } from "zod";
import { adLabErrorResponse, requireAdLabUser } from "../../_guard";
import { AdLabAdsError, adLabAdsService } from "@/services/ad-lab/AdLabAdsService";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  brandId: z.string().min(1).max(100),
  targetId: z.string().uuid().nullable().optional(),
  csvText: z.string().min(1).max(200_000),
});

/** POST /api/ad-lab/ads/import — CSV/paste Ads Manager rows (fallback). */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid import." }, { status: 400 });
  try {
    const result = await adLabAdsService.importCsv(
      guard.user.id,
      parsed.data.brandId,
      parsed.data.csvText,
      parsed.data.targetId
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AdLabAdsError) {
      return NextResponse.json({ error: err.message, reason: err.code }, { status: 400 });
    }
    return adLabErrorResponse("POST /api/ad-lab/ads/import", err);
  }
}

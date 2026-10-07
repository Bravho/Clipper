import { NextResponse } from "next/server";
import { adLabErrorResponse, requireAdLabUser } from "../../_guard";
import { adLabOutcomesService } from "@/services/ad-lab/AdLabOutcomesService";

export const dynamic = "force-dynamic";

/** POST /api/ad-lab/outcomes/stripe?brandId=&days=30 — read-only Stripe revenue snapshot. */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const brandId = url.searchParams.get("brandId")?.trim();
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") || 30) || 30));
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  try {
    const stripe = await adLabOutcomesService.captureStripeRevenue(guard.user.id, brandId, days);
    return NextResponse.json({ stripe });
  } catch (err) {
    return adLabErrorResponse("POST /api/ad-lab/outcomes/stripe", err);
  }
}

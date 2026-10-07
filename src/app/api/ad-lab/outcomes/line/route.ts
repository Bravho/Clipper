import { NextResponse } from "next/server";
import { adLabErrorResponse, requireAdLabUser } from "../../_guard";
import { adLabOutcomesService } from "@/services/ad-lab/AdLabOutcomesService";

export const dynamic = "force-dynamic";

function brandIdFrom(request: Request): string | null {
  const url = new URL(request.url);
  const brandId = url.searchParams.get("brandId")?.trim();
  return brandId || null;
}

/** GET /api/ad-lab/outcomes/line?brandId= — history only. */
export async function GET(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const brandId = brandIdFrom(request);
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  try {
    const line = await adLabOutcomesService.getLineFriends(guard.user.id, brandId);
    return NextResponse.json({ line });
  } catch (err) {
    return adLabErrorResponse("GET /api/ad-lab/outcomes/line", err);
  }
}

/** POST /api/ad-lab/outcomes/line?brandId= — capture a new friend-count snapshot. */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const brandId = brandIdFrom(request);
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  try {
    const line = await adLabOutcomesService.captureLineFriends(guard.user.id, brandId);
    return NextResponse.json({ line });
  } catch (err) {
    return adLabErrorResponse("POST /api/ad-lab/outcomes/line", err);
  }
}

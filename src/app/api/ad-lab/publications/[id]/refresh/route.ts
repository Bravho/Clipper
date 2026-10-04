import { NextResponse } from "next/server";
import { adLabPublishingService } from "@/services/ad-lab/AdLabPublishingService";
import { adLabErrorResponse, requireAdLabUser } from "../../../_guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/ad-lab/publications/:id/refresh — read back each destination's
 * outcome and its latest platform metrics. Never re-sends the post.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    return NextResponse.json(await adLabPublishingService.refresh(guard.user.id, params.id));
  } catch (err) {
    return adLabErrorResponse("POST /api/ad-lab/publications/:id/refresh", err);
  }
}

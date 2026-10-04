import { NextResponse } from "next/server";
import { z } from "zod";
import { adLabPublishingService } from "@/services/ad-lab/AdLabPublishingService";
import { adLabErrorResponse, requireAdLabUser } from "../../_guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  spend: z.number().min(0).max(100_000_000).optional(),
  revenue: z.number().min(0).max(1_000_000_000).optional(),
  conversions: z.number().min(0).max(10_000_000).optional(),
});

/** PATCH /api/ad-lab/targets/:targetId — the owner's spend / revenue / conversions for one post. */
export async function PATCH(request: Request, { params }: { params: { targetId: string } }) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  if (!UUID.test(params.targetId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid values." }, { status: 400 });
  try {
    const publication = await adLabPublishingService.updateEconomics(guard.user.id, params.targetId, parsed.data);
    return NextResponse.json({ publication });
  } catch (err) {
    return adLabErrorResponse("PATCH /api/ad-lab/targets/:targetId", err);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { adLabPublishingService } from "@/services/ad-lab/AdLabPublishingService";
import { adLabErrorResponse, requireAdLabUser } from "../_guard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  brandId: z.string().min(1).max(100),
  draftId: z.string().min(1).max(100),
  planId: z.string().max(100).nullable().optional(),
  campaignName: z.string().trim().max(300),
  caption: z.string().max(5_000),
  title: z.string().max(300).optional(),
  videoKey: z.string().min(1).max(600),
  videoName: z.string().max(255),
  targets: z.array(z.object({
    channel: z.enum(["tiktok", "instagram", "facebook", "youtube"]),
    connectionId: z.string().min(1).max(100),
    plannedBudget: z.number().min(0).max(100_000_000).optional(),
  })).min(1).max(20),
});

/** GET /api/ad-lab/publications — the owner's published campaigns with results. */
export async function GET() {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ publications: await adLabPublishingService.list(guard.user.id) });
  } catch (err) {
    return adLabErrorResponse("GET /api/ad-lab/publications", err);
  }
}

/** POST /api/ad-lab/publications — publish one uploaded video to the selected accounts now. */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid publication." }, { status: 400 });
  try {
    const publication = await adLabPublishingService.publish(guard.user.id, parsed.data);
    return NextResponse.json({ publication }, { status: 201 });
  } catch (err) {
    return adLabErrorResponse("POST /api/ad-lab/publications", err);
  }
}

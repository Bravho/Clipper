import { NextResponse } from "next/server";
import { z } from "zod";
import { adLabPublishingService } from "@/services/ad-lab/AdLabPublishingService";
import { adLabErrorResponse, requireAdLabUser } from "../_guard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSizeBytes: z.number().int().positive(),
  mimeType: z.string().trim().min(1).max(100),
});

/**
 * POST /api/ad-lab/uploads — presigned PUT for the video to publish. The
 * browser uploads straight to Spaces; the key is returned for the publish call.
 */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  try {
    return NextResponse.json(
      await adLabPublishingService.beginVideoUpload({ userId: guard.user.id, ...parsed.data })
    );
  } catch (err) {
    return adLabErrorResponse("POST /api/ad-lab/uploads", err);
  }
}

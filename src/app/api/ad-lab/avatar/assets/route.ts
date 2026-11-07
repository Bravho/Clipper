import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdLabUser } from "../../_guard";
import { avatarService } from "../_service";
import { avatarErrorResponse } from "../_avatarGuard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  draftId: z.string().trim().min(1).max(255),
  audioKey: z.string().trim().min(1).max(1024),
  confirmCost: z.literal(true, {
    errorMap: () => ({ message: "confirmCost must be true (confirm the cost first)." }),
  }),
});

/**
 * POST /api/ad-lab/avatar/assets - upload the saved ElevenLabs audio to HeyGen.
 * Returns { audioAssetId, assetToken }; the client stores them in draft.avatar.video
 * and passes them to POST /video along with a lookId.
 *
 * Image upload is no longer required — Avatar V uses a Digital Twin lookId instead.
 */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await avatarService.prepareVideoAssets(guard.user.id, {
        draftId: parsed.data.draftId,
        audioKey: parsed.data.audioKey,
      })
    );
  } catch (err) {
    return avatarErrorResponse("POST /api/ad-lab/avatar/assets", err);
  }
}

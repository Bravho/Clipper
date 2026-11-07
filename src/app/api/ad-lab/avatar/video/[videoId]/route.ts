import { NextResponse } from "next/server";
import { requireAdLabUser } from "../../../_guard";
import { avatarService } from "../../_service";
import { avatarErrorResponse } from "../../_avatarGuard";

export const dynamic = "force-dynamic";

/**
 * GET /api/ad-lab/avatar/video/[videoId]?draftId=&token=
 *
 * Poll the HeyGen generation status. On completion, the MP4 is stream-copied
 * into Spaces (idempotent) and signed URLs are returned.
 */
export async function GET(
  request: Request,
  { params }: { params: { videoId: string } }
) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const draftId = url.searchParams.get("draftId") ?? "";
  const token = url.searchParams.get("token") ?? "";

  if (!draftId || !token || !params.videoId) {
    return NextResponse.json({ error: "draftId และ token จำเป็นต้องระบุ" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await avatarService.getVideoStatus(guard.user.id, {
        draftId,
        videoId: params.videoId,
        token,
      })
    );
  } catch (err) {
    return avatarErrorResponse("GET /api/ad-lab/avatar/video/[videoId]", err);
  }
}

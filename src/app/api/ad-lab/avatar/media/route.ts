import { NextResponse } from "next/server";
import { requireAdLabUser } from "../../_guard";
import { avatarService } from "../_service";
import { avatarErrorResponse } from "../_avatarGuard";

export const dynamic = "force-dynamic";

/**
 * GET /api/ad-lab/avatar/media?key=&draftId=&download=1
 *
 * Return a short-lived signed URL for a private avatar asset.
 */
export async function GET(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const draftId = url.searchParams.get("draftId") ?? "";
  const download = url.searchParams.get("download") === "1";

  if (!key || !draftId) {
    return NextResponse.json({ error: "key และ draftId จำเป็นต้องระบุ" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await avatarService.signedMedia(guard.user.id, { key, draftId, download })
    );
  } catch (err) {
    return avatarErrorResponse("GET /api/ad-lab/avatar/media", err);
  }
}

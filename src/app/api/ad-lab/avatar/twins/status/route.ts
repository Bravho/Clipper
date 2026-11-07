import { NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "../../../_guard";
import { avatarService } from "../../_service";
import { avatarErrorResponse } from "../../_avatarGuard";

export const dynamic = "force-dynamic";

/**
 * GET /api/ad-lab/avatar/twins/status?lookId=&groupId=
 *
 * Polls the training status of a Digital Twin. At least one of lookId or
 * groupId must be provided. Combine both to get full status in one call.
 *
 * Response: { lookStatus?: string, avatarV: boolean, consentStatus?: string, error?: string }
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;

  const { searchParams } = req.nextUrl;
  const lookId = searchParams.get("lookId") ?? undefined;
  const groupId = searchParams.get("groupId") ?? undefined;

  if (!lookId && !groupId) {
    return NextResponse.json(
      { error: "At least one of lookId or groupId is required." },
      { status: 400 }
    );
  }

  try {
    const result = await avatarService.getTwinStatus(guard.user.id, { lookId, groupId });
    return NextResponse.json(result);
  } catch (err) {
    return avatarErrorResponse("GET /api/ad-lab/avatar/twins/status", err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "../../../../_guard";
import { avatarService } from "../../../_service";
import { avatarErrorResponse } from "../../../_avatarGuard";

export const dynamic = "force-dynamic";

/**
 * POST /api/ad-lab/avatar/twins/{groupId}/consent
 *
 * Requests (or refreshes) the consent URL for a Digital Twin group.
 * The returned url is valid for 24 hours. Calling again issues a fresh link.
 * Returns 409 (twin_consent_conflict) if consent is already accepted or under review.
 *
 * Response: { url: string, consentStatus: string }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;

  const { groupId } = params;
  if (!groupId?.trim()) {
    return NextResponse.json({ error: "groupId is required." }, { status: 400 });
  }

  try {
    const result = await avatarService.requestTwinConsentUrl(guard.user.id, {
      groupId: groupId.trim(),
    });
    return NextResponse.json(result);
  } catch (err) {
    return avatarErrorResponse(`POST /api/ad-lab/avatar/twins/${groupId}/consent`, err);
  }
}

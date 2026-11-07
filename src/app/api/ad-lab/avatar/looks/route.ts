import { NextResponse } from "next/server";
import { requireAdLabUser } from "../../_guard";
import { avatarService } from "../_service";
import { avatarErrorResponse } from "../_avatarGuard";

export const dynamic = "force-dynamic";

/**
 * GET /api/ad-lab/avatar/looks
 *
 * Returns all private HeyGen Digital Twin looks for the Avatar V picker.
 * Each look has a `selectable` boolean (true = digital_twin + avatar_v + completed).
 * Response: { configured: boolean, looks: [{id, name, previewImageUrl?, previewVideoUrl?, status?, selectable}], defaultLookId?: string }
 *
 * When HEYGEN_API_KEY is absent: { configured: false, looks: [] } with HTTP 200.
 */
export async function GET() {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await avatarService.getLooks());
  } catch (err) {
    return avatarErrorResponse("GET /api/ad-lab/avatar/looks", err);
  }
}

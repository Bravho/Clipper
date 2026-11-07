import { NextResponse } from "next/server";
import { requireAdLabUser } from "../../_guard";
import { avatarService } from "../_service";
import { avatarErrorResponse } from "../_avatarGuard";

export const dynamic = "force-dynamic";

/** GET /api/ad-lab/avatar/config — voice list, cost rates, feature flags. */
export async function GET() {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(avatarService.getConfig());
  } catch (err) {
    return avatarErrorResponse("GET /api/ad-lab/avatar/config", err);
  }
}

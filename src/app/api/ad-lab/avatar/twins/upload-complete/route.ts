import { NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "../../../_guard";
import { avatarService } from "../../_service";
import { avatarErrorResponse } from "../../_avatarGuard";

export const dynamic = "force-dynamic";

/**
 * POST /api/ad-lab/avatar/twins/upload-complete
 *
 * Marks a direct-upload asset as complete. Call this after the browser
 * finishes the PUT to uploadUrl. Idempotent — safe to call more than once.
 *
 * Body: { assetId: string }
 * Response: {}
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { assetId } = body as Record<string, unknown>;
  if (typeof assetId !== "string" || !assetId.trim()) {
    return NextResponse.json({ error: "assetId is required." }, { status: 400 });
  }

  try {
    await avatarService.completeTwinUpload(guard.user.id, { assetId: assetId.trim() });
    return NextResponse.json({});
  } catch (err) {
    return avatarErrorResponse("POST /api/ad-lab/avatar/twins/upload-complete", err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "../../_guard";
import { avatarService } from "../_service";
import { avatarErrorResponse } from "../_avatarGuard";

export const dynamic = "force-dynamic";

/**
 * POST /api/ad-lab/avatar/twins
 *
 * Creates a Digital Twin avatar from an uploaded video asset.
 * Pass Idempotency-Key via body to prevent duplicate twins on retries.
 *
 * Body: { name: string, assetId: string, idempotencyKey: string, confirmCost: true }
 * Response: { lookId: string, groupId: string, defaultVoiceId?: string }
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

  const {
    name,
    assetId,
    idempotencyKey,
    confirmCost,
    avatarGroupId,
    clientDurationSec,
    clientWidth,
    clientHeight,
  } = body as Record<string, unknown>;

  if (confirmCost !== true) {
    return NextResponse.json({ error: "confirmCost must be true." }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (typeof assetId !== "string" || !assetId.trim()) {
    return NextResponse.json({ error: "assetId is required." }, { status: 400 });
  }
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    return NextResponse.json({ error: "idempotencyKey is required." }, { status: 400 });
  }
  if (avatarGroupId !== undefined && (typeof avatarGroupId !== "string" || !avatarGroupId.trim())) {
    return NextResponse.json({ error: "avatarGroupId must be a non-empty string." }, { status: 400 });
  }

  try {
    const result = await avatarService.createTwin(guard.user.id, {
      name: name.trim(),
      assetId: assetId.trim(),
      idempotencyKey: idempotencyKey.trim(),
      avatarGroupId: typeof avatarGroupId === "string" ? avatarGroupId.trim() : undefined,
      clientDurationSec: typeof clientDurationSec === "number" ? clientDurationSec : undefined,
      clientWidth: typeof clientWidth === "number" ? clientWidth : undefined,
      clientHeight: typeof clientHeight === "number" ? clientHeight : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return avatarErrorResponse("POST /api/ad-lab/avatar/twins", err);
  }
}

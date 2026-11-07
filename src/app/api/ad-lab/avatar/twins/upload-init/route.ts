import { NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "../../../_guard";
import { avatarService } from "../../_service";
import { avatarErrorResponse } from "../../_avatarGuard";

export const dynamic = "force-dynamic";

/**
 * POST /api/ad-lab/avatar/twins/upload-init
 *
 * Validates the video file metadata and requests a pre-signed direct-upload
 * URL from HeyGen. The browser then PUTs the raw bytes directly to uploadUrl
 * using uploadHeaders verbatim (the size is signed into the URL so it must
 * not be changed). No server-side buffering of the file.
 *
 * Body: { fileName: string, contentType: string, sizeBytes: number, durationSec?: number }
 * Response: { assetId: string, uploadUrl: string, uploadHeaders: Record<string,string> }
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

  const { fileName, contentType, sizeBytes, durationSec } = body as Record<string, unknown>;

  if (typeof fileName !== "string" || !fileName.trim()) {
    return NextResponse.json({ error: "fileName is required." }, { status: 400 });
  }
  if (typeof contentType !== "string" || !contentType.trim()) {
    return NextResponse.json({ error: "contentType is required." }, { status: 400 });
  }
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes)) {
    return NextResponse.json({ error: "sizeBytes must be an integer." }, { status: 400 });
  }
  if (durationSec !== undefined && typeof durationSec !== "number") {
    return NextResponse.json({ error: "durationSec must be a number." }, { status: 400 });
  }

  try {
    const result = await avatarService.initiateTwinUpload(guard.user.id, {
      fileName: fileName.trim(),
      contentType: contentType.trim(),
      sizeBytes,
      durationSec: typeof durationSec === "number" ? durationSec : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return avatarErrorResponse("POST /api/ad-lab/avatar/twins/upload-init", err);
  }
}

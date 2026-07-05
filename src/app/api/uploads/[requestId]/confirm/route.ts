import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { uploadService, UploadValidationError } from "@/services/UploadService";
import { clipRequestService } from "@/services/ClipRequestService";

/**
 * POST /api/uploads/[requestId]/confirm
 *
 * Step 3 of the presigned URL upload flow.
 *
 * Called after the client has successfully PUT the file to DO Spaces
 * using the presigned URL from Step 1.
 *
 * This endpoint:
 *   - Copies the object from tmp/ to request_mat/
 *   - Deletes the tmp/ object
 *   - Reserves a thumbnail key in thumbnails/ (actual generation is async)
 *   - Marks the asset record as Uploaded
 *
 * Request body: { assetId }
 * Response:     { asset }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  if (session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Verify the request belongs to this user
  try {
    await clipRequestService.getOwnedRequest(requestId, session.user.id);
  } catch {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  let body: { assetId?: unknown; posterDataUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { assetId } = body;
  if (typeof assetId !== "string") {
    return NextResponse.json({ error: "Missing required field: assetId (string)." }, { status: 400 });
  }

  // Optional browser-captured video poster. Accept only a base64 image data URL,
  // and cap the size (~1.5 MB) so a malformed/oversized payload can't be abused;
  // an over-limit or malformed value is simply ignored (server falls back to
  // ffmpeg extraction).
  const MAX_POSTER_CHARS = 1_500_000;
  const posterDataUrl =
    typeof body.posterDataUrl === "string" &&
    body.posterDataUrl.startsWith("data:image/") &&
    body.posterDataUrl.length <= MAX_POSTER_CHARS
      ? body.posterDataUrl
      : undefined;

  try {
    const asset = await uploadService.confirmUpload(assetId, session.user.id, posterDataUrl);
    return NextResponse.json({ asset }, { status: 200 });
  } catch (err) {
    // Business-rule rejections (e.g. clip too long) → 422, not 500.
    if (err instanceof UploadValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[POST /api/uploads/[requestId]/confirm]", err);
    const message = err instanceof Error ? err.message : "Failed to confirm upload.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

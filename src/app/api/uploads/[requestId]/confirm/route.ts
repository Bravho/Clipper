import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { uploadService } from "@/services/UploadService";
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

  let body: { assetId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { assetId } = body;
  if (typeof assetId !== "string") {
    return NextResponse.json({ error: "Missing required field: assetId (string)." }, { status: 400 });
  }

  try {
    const asset = await uploadService.confirmUpload(assetId, session.user.id);
    return NextResponse.json({ asset }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/uploads/[requestId]/confirm]", err);
    const message = err instanceof Error ? err.message : "Failed to confirm upload.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

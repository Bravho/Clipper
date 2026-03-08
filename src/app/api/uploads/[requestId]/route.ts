import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { uploadService } from "@/services/UploadService";
import { clipRequestService } from "@/services/ClipRequestService";
import { MAX_UPLOAD_COUNT } from "@/domain/enums/AssetType";

/**
 * POST /api/uploads/[requestId]
 *
 * Step 1 of the presigned URL upload flow.
 *
 * Accepts file metadata, validates the file and request ownership, then
 * generates a presigned PUT URL for the tmp/ folder in DO Spaces.
 * The client uses this URL to upload the file DIRECTLY to DO Spaces.
 *
 * Request body: { fileName, fileSizeBytes, mimeType }
 * Response:     { assetId, presignedUrl, storageKey }
 *
 * After the client completes the PUT, it must call
 * POST /api/uploads/[requestId]/confirm to move the file from tmp/ to
 * request_mat/ and mark the asset as Uploaded.
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

  // Check existing upload count
  const currentCount = await uploadService.countAssets(requestId);
  if (currentCount >= MAX_UPLOAD_COUNT) {
    return NextResponse.json(
      { error: `Maximum ${MAX_UPLOAD_COUNT} files per request.` },
      { status: 422 }
    );
  }

  let body: { fileName?: unknown; fileSizeBytes?: unknown; mimeType?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { fileName, fileSizeBytes: fileSizeBytesRaw, mimeType } = body;

  if (
    typeof fileName !== "string" ||
    typeof fileSizeBytesRaw !== "number" ||
    typeof mimeType !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing required fields: fileName (string), fileSizeBytes (number), mimeType (string)." },
      { status: 400 }
    );
  }

  if (fileSizeBytesRaw <= 0) {
    return NextResponse.json({ error: "Invalid file size." }, { status: 400 });
  }

  // Validate file type and size
  const validation = uploadService.validateFile(
    { name: fileName, size: fileSizeBytesRaw, type: mimeType },
    currentCount
  );
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 422 });
  }

  try {
    const result = await uploadService.createPresignedUpload({
      requestId,
      userId: session.user.id,
      fileName,
      fileSizeBytes: fileSizeBytesRaw,
      mimeType,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[POST /api/uploads/[requestId]]", err);
    return NextResponse.json({ error: "Failed to create upload." }, { status: 500 });
  }
}

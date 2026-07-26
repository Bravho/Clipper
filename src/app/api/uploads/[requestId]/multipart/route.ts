import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { uploadService } from "@/services/UploadService";
import { clipRequestService } from "@/services/ClipRequestService";
import { MAX_UPLOAD_COUNT } from "@/domain/enums/AssetType";

/**
 * POST /api/uploads/[requestId]/multipart
 *
 * Chunked (multipart) sibling of the single-PUT presign flow. Large files —
 * notably videos over ~5 MB — cannot go up as one PUT because an HTTPS-inspecting
 * network intermediary rejects any single request body over ~8–15 MB (see
 * lib/spaces.ts); the browser sees the intermediary's non-CORS error as the
 * opaque "Failed to fetch". Splitting the upload into ≤5 MB parts keeps every
 * request under that cap.
 *
 * One route, four actions (dispatched on body.action):
 *   initiate → { assetId, key, uploadId, partSize }   (creates tmp/ MPU + Pending asset)
 *   sign     → { parts: [{ partNumber, url }] }        (presigned UploadPart URLs)
 *   complete → { ok: true }                            (assembles the object; then call /confirm)
 *   abort    → { ok: true }                            (best-effort cleanup)
 *
 * After `complete`, the object sits at the tmp/ key exactly as a single PUT would
 * leave it, so the client finishes with the existing POST /confirm.
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

  const userId = session.user.id;

  // Ownership: the request must belong to this user.
  try {
    await clipRequestService.getOwnedRequest(requestId, userId);
  } catch {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = body.action;

  // Any action operating on an existing key must prove that key belongs to this
  // user AND this request, so a signed part URL can't be minted for someone
  // else's object. tmp key shape: tmp/{userId}/{date}/{requestId}/{uuid}-{name}.
  const keyBelongsToCaller = (key: unknown): key is string =>
    typeof key === "string" &&
    key.startsWith(`tmp/${userId}/`) &&
    key.includes(`/${requestId}/`);

  try {
    if (action === "initiate") {
      const { fileName, fileSizeBytes, mimeType } = body as {
        fileName?: unknown;
        fileSizeBytes?: unknown;
        mimeType?: unknown;
      };
      if (
        typeof fileName !== "string" ||
        typeof fileSizeBytes !== "number" ||
        typeof mimeType !== "string"
      ) {
        return NextResponse.json(
          { error: "Missing fields: fileName (string), fileSizeBytes (number), mimeType (string)." },
          { status: 400 }
        );
      }
      if (fileSizeBytes <= 0) {
        return NextResponse.json({ error: "Invalid file size." }, { status: 400 });
      }

      // Same guards as the single-PUT presign route: file count, type, per-file
      // and per-request total size.
      const currentCount = await uploadService.countAssets(requestId);
      if (currentCount >= MAX_UPLOAD_COUNT) {
        return NextResponse.json(
          { error: `Maximum ${MAX_UPLOAD_COUNT} files per request.` },
          { status: 422 }
        );
      }
      const existingBytes = await uploadService.sumUploadedBytes(requestId);
      const validation = uploadService.validateFile(
        { name: fileName, size: fileSizeBytes, type: mimeType },
        currentCount,
        existingBytes
      );
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 422 });
      }

      const result = await uploadService.createMultipartUpload({
        requestId,
        userId,
        fileName,
        fileSizeBytes,
        mimeType,
      });
      return NextResponse.json(result, { status: 201 });
    }

    if (action === "sign") {
      const { key, uploadId, partCount } = body as {
        key?: unknown;
        uploadId?: unknown;
        partCount?: unknown;
      };
      if (!keyBelongsToCaller(key) || typeof uploadId !== "string") {
        return NextResponse.json({ error: "Invalid key or uploadId." }, { status: 400 });
      }
      if (typeof partCount !== "number" || partCount < 1 || partCount > 10_000) {
        return NextResponse.json({ error: "Invalid partCount (1–10000)." }, { status: 400 });
      }
      const parts = await uploadService.signUploadParts({ key, uploadId, partCount });
      return NextResponse.json({ parts }, { status: 200 });
    }

    if (action === "complete") {
      const { key, uploadId, parts } = body as {
        key?: unknown;
        uploadId?: unknown;
        parts?: unknown;
      };
      if (!keyBelongsToCaller(key) || typeof uploadId !== "string") {
        return NextResponse.json({ error: "Invalid key or uploadId." }, { status: 400 });
      }
      if (
        !Array.isArray(parts) ||
        parts.length === 0 ||
        !parts.every(
          (p) =>
            p &&
            typeof p.PartNumber === "number" &&
            typeof p.ETag === "string" &&
            p.ETag.length > 0
        )
      ) {
        return NextResponse.json({ error: "Invalid parts array." }, { status: 400 });
      }
      await uploadService.completeMultipartUpload({
        key,
        uploadId,
        parts: parts as { PartNumber: number; ETag: string }[],
      });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (action === "abort") {
      const { key, uploadId } = body as { key?: unknown; uploadId?: unknown };
      if (!keyBelongsToCaller(key) || typeof uploadId !== "string") {
        return NextResponse.json({ error: "Invalid key or uploadId." }, { status: 400 });
      }
      await uploadService.abortMultipartUpload({ key, uploadId });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    return NextResponse.json(
      { error: "Unknown action. Expected initiate | sign | complete | abort." },
      { status: 400 }
    );
  } catch (err) {
    console.error(`[POST /api/uploads/[requestId]/multipart] action=${String(action)}`, err);
    return NextResponse.json({ error: "Multipart upload operation failed." }, { status: 500 });
  }
}

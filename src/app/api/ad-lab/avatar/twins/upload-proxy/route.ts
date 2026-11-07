import { NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "../../../_guard";
import { avatarService } from "../../_service";
import { avatarErrorResponse } from "../../_avatarGuard";

export const dynamic = "force-dynamic";

const PROXY_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * POST /api/ad-lab/avatar/twins/upload-proxy
 *
 * Server-side streaming proxy for Digital Twin training video uploads.
 * Use as a fallback when the browser's direct PUT to the HeyGen presigned
 * URL fails due to CORS or network error (XHR status 0 / onerror).
 *
 * Query params: fileName, contentType, sizeBytes, durationSec (optional)
 * Body: raw video bytes (streamed — no server-side buffering)
 * Returns: { assetId: string }
 *
 * Design: obtains a fresh presigned upload URL from HeyGen server-side (the
 * upload_url from the client is never trusted). The request body streams
 * through a counting TransformStream (aborts over 200 MB) directly to
 * HeyGen's presigned URL via fetch with duplex:"half". The returned assetId
 * may differ from the one obtained via upload-init; the client must update
 * its draft and continue with upload-complete using the new assetId.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const fileName = sp.get("fileName");
  const contentType = sp.get("contentType");
  const sizeBytesStr = sp.get("sizeBytes");
  const durationSecStr = sp.get("durationSec");

  if (!fileName?.trim()) {
    return NextResponse.json({ error: "fileName is required." }, { status: 400 });
  }
  if (!contentType?.trim()) {
    return NextResponse.json({ error: "contentType is required." }, { status: 400 });
  }
  const sizeBytes = parseInt(sizeBytesStr ?? "", 10);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "sizeBytes must be a positive integer." }, { status: 400 });
  }
  if (sizeBytes > PROXY_MAX_BYTES) {
    return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 200 MB" }, { status: 413 });
  }

  // Fast-fail via Content-Length header before the HeyGen round-trip.
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const cl = parseInt(contentLength, 10);
    if (Number.isFinite(cl) && cl > PROXY_MAX_BYTES) {
      return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 200 MB" }, { status: 413 });
    }
  }

  const durationSec =
    durationSecStr !== null && durationSecStr !== ""
      ? parseFloat(durationSecStr)
      : undefined;

  // Obtain a fresh presigned upload URL from HeyGen server-side.
  // The upload_url received by the browser must never be forwarded directly.
  let uploadInfo: { assetId: string; uploadUrl: string; uploadHeaders: Record<string, string> };
  try {
    uploadInfo = await avatarService.initiateTwinUpload(guard.user.id, {
      fileName: fileName.trim(),
      contentType: contentType.trim(),
      sizeBytes,
      durationSec,
    });
  } catch (err) {
    return avatarErrorResponse("POST /api/ad-lab/avatar/twins/upload-proxy (initiate)", err);
  }

  const { assetId, uploadUrl, uploadHeaders } = uploadInfo;

  if (!req.body) {
    return NextResponse.json({ error: "ไม่พบข้อมูลไฟล์ในคำขอ" }, { status: 400 });
  }

  // Counting TransformStream: abort if cumulative bytes exceed 200 MB.
  let bytesThrough = 0;
  const countingStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesThrough += chunk.byteLength;
      if (bytesThrough > PROXY_MAX_BYTES || bytesThrough > sizeBytes) {
        controller.error(new Error("over_200mb"));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  const piped = req.body.pipeThrough(countingStream);

  try {
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { ...uploadHeaders, "Content-Length": String(sizeBytes) },
      body: piped,
      // @ts-expect-error duplex is required for streaming request bodies in Node.js fetch
      duplex: "half",
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");
      return NextResponse.json(
        { error: `อัปโหลดไปยัง HeyGen ไม่สำเร็จ (${uploadRes.status}): ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cause = (err as { cause?: unknown })?.cause;
    const causeMsg = cause instanceof Error ? cause.message : "";
    if (msg === "over_200mb" || causeMsg === "over_200mb" || bytesThrough > PROXY_MAX_BYTES || bytesThrough > sizeBytes) {
      return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 200 MB" }, { status: 413 });
    }
    return NextResponse.json(
      { error: `อัปโหลดล้มเหลว: ${msg.slice(0, 200)}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ assetId });
}

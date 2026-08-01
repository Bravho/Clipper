import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, uploadedAssetRepository } from "@/repositories/index";
import {
  SPACES_BUCKET,
  spacesClient,
  spacesSendWithRetry,
  spacesSignedUrl,
} from "@/lib/spaces";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { attachmentContentDisposition } from "@/lib/downloadHeaders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short lifetime for the clean-master download link (minutes, not the 1h default). */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * GET /api/requests/[id]/download?assetId=...
 *
 * Returns download metadata or, with `direct=1`, streams the clean
 * (non-watermarked) final master as a same-origin attachment — but ONLY when the
 * request's download is unlocked (paid). This is the paywall: the clean master
 * is never handed out until `downloadUnlocked` is true.
 *
 * The requester may still WATCH the preview via /stream while locked; downloading
 * the clean file requires payment. (Watermarking the streamed preview so the
 * preview itself is worthless to rip is the remaining render-pipeline work.)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const clipRequest = await clipRequestRepository.findById(id);
  if (!clipRequest) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const isOwner = clipRequest.userId === session.user.id;
  const isStaff = session.user.role === Role.Admin;
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Paywall: owners must have unlocked the download. Staff/Admin bypass for QA.
  if (isOwner && !isStaff && !clipRequest.downloadUnlocked) {
    return NextResponse.json(
      {
        error: "Download locked. Pay to unlock the clean video.",
        locked: true,
      },
      { status: 402 }
    );
  }

  const assetId = request.nextUrl.searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json({ error: "Missing assetId." }, { status: 400 });
  }

  const asset = await uploadedAssetRepository.findById(assetId);
  if (!asset || asset.requestId !== id) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  // Name the file after the place and the distribution channel it was clicked
  // for — e.g. "ร้านกาแฟ - TikTok.mp4" — so a requester downloading every
  // channel gets clearly-named files.
  const channelName = request.nextUrl.searchParams.get("channel")?.trim();
  const ext = asset.fileName?.split(".").pop()?.toLowerCase() || "mp4";
  const place =
    clipRequest.placeName?.trim() || clipRequest.title?.trim() || "RClipper";
  const baseName = [place, channelName].filter(Boolean).join(" - ");
  const downloadFileName = `${baseName || "rclipper-video"}.${ext}`;

  // Web browsers download through this same-origin streaming response. A
  // cross-origin `<a download>` is not reliable because browsers may ignore the
  // attribute; proxying the object lets this API return a real attachment
  // response while retaining the authentication and paywall checks above.
  if (request.nextUrl.searchParams.get("direct") === "1") {
    try {
      const obj = await spacesSendWithRetry(`download ${asset.storageKey}`, () =>
        spacesClient.send(
          new GetObjectCommand({
            Bucket: SPACES_BUCKET,
            Key: asset.storageKey,
          })
        )
      );
      if (!obj.Body) {
        throw new Error("Spaces returned an empty response body.");
      }

      const webStream = (
        obj.Body as { transformToWebStream: () => ReadableStream }
      ).transformToWebStream();
      const headers = new Headers();
      headers.set(
        "Content-Type",
        asset.mimeType || obj.ContentType || "application/octet-stream"
      );
      headers.set(
        "Content-Disposition",
        attachmentContentDisposition(downloadFileName)
      );
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      if (obj.ContentLength != null) {
        headers.set("Content-Length", String(obj.ContentLength));
      }

      return new NextResponse(webStream, { status: 200, headers });
    } catch (err) {
      console.error("[download] failed to stream asset:", err);
      return NextResponse.json(
        { error: "Failed to download video." },
        { status: 502 }
      );
    }
  }

  // Native apps still need a presigned URL because their OS-level HTTP client
  // does not automatically carry the browser session cookie.
  const url = await spacesSignedUrl(asset.storageKey, DOWNLOAD_URL_TTL_SECONDS, {
    downloadFileName,
  });
  const directParams = new URLSearchParams(request.nextUrl.searchParams);
  directParams.set("direct", "1");
  const downloadUrl = `${request.nextUrl.pathname}?${directParams.toString()}`;

  return NextResponse.json({
    url,
    downloadUrl,
    fileName: downloadFileName,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
}

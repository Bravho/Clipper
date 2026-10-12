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
import { videoAccessService } from "@/services/VideoAccessService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short lifetime for the clean-master download link (minutes, not the 1h default). */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * GET /api/requests/[id]/download?assetId=...
 *
 * Returns download metadata or, with `direct=1`, streams the final video as a
 * same-origin attachment — but ONLY when VideoAccessService says the video may
 * leave the app: a free request needs a package (402, `reason:
 * "package_required"`), and every video stops being available on its
 * `videosExpireAt` (410, `reason: "expired"`).
 *
 * The requester may still WATCH a locked video in the app via /stream.
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

  // Owners may take a video out of the app only when it is unlocked (a package
  // paid for it, or a purchase since unlocked it) and not expired. Admin
  // bypasses for QA. See VideoAccessService.
  if (isOwner && !isStaff) {
    const access = await videoAccessService.accessFor(clipRequest);
    if (!access.canDownload) {
      const expired = access.downloadBlock === "expired";
      return NextResponse.json(
        {
          error: expired
            ? "This video has expired and is no longer available."
            : "Buy a package to download this video.",
          locked: !expired,
          reason: access.downloadBlock,
          expiresAt: access.expiresAt?.toISOString() ?? null,
        },
        { status: expired ? 410 : 402 }
      );
    }
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

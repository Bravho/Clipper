import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, uploadedAssetRepository } from "@/repositories/index";
import { spacesClient } from "@/lib/spaces";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { AssetType } from "@/domain/enums/AssetType";
import { isAppUserAgent } from "@/lib/mobile/appUserAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/requests/[id]/stream?assetId=...
 *
 * Same-origin streaming proxy for a request's stored media (voice MP3, etc.).
 *
 * Why this exists: the public DO Spaces / CDN URL is fine for a full download,
 * but a CDN in front of object storage can mishandle HTTP Range requests, which
 * makes an inline <audio>/<video> element show a timeline but play no sound.
 * Streaming through this route hits S3 directly (no CDN), forwards the browser's
 * Range header, and returns the correct Content-Type + 206/Content-Range — so
 * inline playback and seeking work reliably.
 *
 * Access: the owning requester, or any Editor/Admin. The asset must belong to
 * the request in the URL (prevents cross-request asset access). A free
 * request's finished video plays only inside the app, and no finished video
 * plays after it expires (see the check below).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new NextResponse("Unauthorised", { status: 401 });
  }

  const clipRequest = await clipRequestRepository.findById(id);
  if (!clipRequest) {
    return new NextResponse("Not found", { status: 404 });
  }
  const isOwner = clipRequest.userId === session.user.id;
  const isStaff = session.user.role === Role.Admin;
  if (!isOwner && !isStaff) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const assetId = request.nextUrl.searchParams.get("assetId");
  if (!assetId) {
    return new NextResponse("Missing assetId", { status: 400 });
  }
  const asset = await uploadedAssetRepository.findById(assetId);
  if (!asset || asset.requestId !== id) {
    return new NextResponse("Asset not found", { status: 404 });
  }

  // A finished video of a FREE request is for watching in the app only
  // (VideoAccessService): outside the app — a signed-in desktop browser — this
  // route would otherwise be a download in all but name. An expired video is
  // gone everywhere. Admin bypasses for QA.
  if (isOwner && !isStaff && asset.assetType === AssetType.FinalClip) {
    const expired =
      clipRequest.videosExpireAt != null &&
      clipRequest.videosExpireAt.getTime() <= Date.now();
    if (expired) {
      return new NextResponse("This video has expired.", { status: 410 });
    }
    // iOS plays <video> through AVPlayer, whose requests carry its own
    // "AppleCoreMedia" user agent rather than the app's — let those through or
    // a free video made on another device would not play in the iOS app. This
    // is a speed bump, not a lock: a user agent can be faked. The real lock is
    // the download route and the transfer gate.
    const userAgent = request.headers.get("user-agent");
    const inApp = isAppUserAgent(userAgent) || /AppleCoreMedia/i.test(userAgent ?? "");
    if (!clipRequest.downloadUnlocked && !inApp) {
      return new NextResponse("Free videos can be watched in the RClipper app.", {
        status: 402,
      });
    }
  }

  const range = request.headers.get("range") ?? undefined;

  try {
    const obj = await spacesClient.send(
      new GetObjectCommand({
        Bucket: process.env.DO_SPACES_BUCKET!,
        Key: asset.storageKey,
        Range: range,
      })
    );

    const webStream = (
      obj.Body as { transformToWebStream: () => ReadableStream }
    ).transformToWebStream();

    const headers = new Headers();
    headers.set("Content-Type", asset.mimeType || obj.ContentType || "application/octet-stream");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, max-age=3600");
    if (obj.ContentLength != null) headers.set("Content-Length", String(obj.ContentLength));
    if (obj.ContentRange) headers.set("Content-Range", obj.ContentRange);

    return new NextResponse(webStream, {
      status: obj.ContentRange ? 206 : 200,
      headers,
    });
  } catch (err) {
    console.error("[stream] failed to stream asset:", err);
    return new NextResponse("Failed to stream asset", { status: 500 });
  }
}

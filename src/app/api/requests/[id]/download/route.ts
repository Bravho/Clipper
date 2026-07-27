import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, uploadedAssetRepository } from "@/repositories/index";
import { spacesSignedUrl } from "@/lib/spaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short lifetime for the clean-master download link (minutes, not the 1h default). */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * GET /api/requests/[id]/download?assetId=...
 *
 * Returns a short-lived presigned URL to the clean (non-watermarked) final master
 * — but ONLY when the request's download is unlocked (paid). This is the paywall:
 * the clean master is never handed out until `downloadUnlocked` is true.
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

  // Serve the presigned URL with Content-Disposition: attachment so the client
  // downloads a real file (in-page on web, saved to the device on mobile) rather
  // than opening the video in a new browser tab. Give it a friendly file name.
  const ratioSuffix = asset.videoRatio ? `_${asset.videoRatio.replace(":", "x")}` : "";
  const downloadFileName = asset.fileName?.trim()
    ? asset.fileName
    : `rclipper-video${ratioSuffix}.mp4`;

  const url = await spacesSignedUrl(asset.storageKey, DOWNLOAD_URL_TTL_SECONDS, {
    downloadFileName,
  });
  return NextResponse.json({
    url,
    fileName: downloadFileName,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
}

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
  const isStaff =
    session.user.role === Role.Editor || session.user.role === Role.Admin;
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

  const url = await spacesSignedUrl(asset.storageKey, DOWNLOAD_URL_TTL_SECONDS);
  return NextResponse.json({ url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS });
}

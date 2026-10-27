import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository } from "@/repositories/index";
import {
  VideoDownloadUnlockService,
  VideoAlreadyUnlockedError,
  VideoUnlockInsufficientCreditsError,
  VideoUnlockExpiredError,
} from "@/services/VideoDownloadUnlockService";

/**
 * POST /api/requests/[id]/download-unlock
 *
 * Spend credits to unlock download for one free request for
 * VIDEO_DOWNLOAD_UNLOCK.days days (config/requestLimits.ts). Channel
 * Management is NOT included. The call is idempotent: a second call for the
 * same user+request returns 200 without a second charge.
 *
 *   200 { charged, creditsSpent, balanceCredits, unlockedUntil }
 *   402 { code: "insufficient_credits", requiredCredits, balanceCredits }
 *   409 { code: "already_unlocked" }
 *   422 { code: "request_expired" }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const requester = await requireRole(Role.Requester);
    const { id } = await params;

    const clipRequest = await clipRequestRepository.findById(id);
    if (!clipRequest || clipRequest.userId !== requester.id) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    if (["auto_cancelled", "rejected"].includes(clipRequest.status) ||
        (clipRequest.videosExpireAt && clipRequest.videosExpireAt.getTime() <= Date.now())) {
      throw new VideoUnlockExpiredError();
    }
    if (clipRequest.status === "draft" || (!clipRequest.downloadUnlocked && clipRequest.pricingTier !== "free")) {
      return NextResponse.json({ error: "Only submitted free requests can be unlocked." }, { status: 409 });
    }

    const service = new VideoDownloadUnlockService();
    const result = await service.purchase({
      userId: requester.id,
      requestId: id,
      currentExpiry: clipRequest.videosExpireAt ?? null,
      alreadyUnlocked: Boolean(clipRequest.downloadUnlocked),
    });

    return NextResponse.json({
      charged: result.charged,
      creditsSpent: result.creditsSpent,
      balanceCredits: result.balanceCredits,
      unlockedUntil: result.unlockedUntil?.toISOString() ?? null,
    });
  } catch (err) {
    if (err instanceof VideoUnlockInsufficientCreditsError) {
      return NextResponse.json(
        { error: err.message, code: err.code, requiredCredits: err.requiredCredits, balanceCredits: err.balanceCredits },
        { status: 402 }
      );
    }
    if (err instanceof VideoAlreadyUnlockedError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof VideoUnlockExpiredError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import {
  videoGenerationService,
  StepLockedAfterApprovalError,
} from "@/services/VideoGenerationService";
import {
  VoiceMakeTopUpCreditsError,
  VoiceMakesStillLeftError,
} from "@/services/VoiceMakeTopUpService";

const schema = z.object({ jobId: z.string().min(1) });

/**
 * POST /api/requests/[id]/voice/top-up
 *
 * Spend credits on more voice makes for this request (config/requestLimits.ts
 * VOICE_MAKE_TOP_UP). Sold only when the request's makes are used up, so
 * repeating the call never charges twice. The studio asks the requester to
 * confirm the price before calling this.
 *
 *   200 { limit, creditsSpent, balanceCredits }
 *   402 { code: "insufficient_credits", requiredCredits, balanceCredits }
 *   409 { code: "voice_makes_still_left" | "locked_after_approval" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const requester = await requireRole(Role.Requester);
    const { id } = await params;

    const clipRequest = await clipRequestRepository.findById(id);
    if (!clipRequest || clipRequest.userId !== requester.id) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const body = schema.parse(await req.json());
    const job = await videoGenerationJobRepository.findById(body.jobId);
    if (!job || job.requestId !== id) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const result = await videoGenerationService.buyVoiceMakes(body.jobId, requester.id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof VoiceMakeTopUpCreditsError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          requiredCredits: err.requiredCredits,
          balanceCredits: err.balanceCredits,
        },
        { status: 402 }
      );
    }
    if (err instanceof VoiceMakesStillLeftError) {
      return NextResponse.json(
        { error: err.message, code: err.code, used: err.used, limit: err.limit },
        { status: 409 }
      );
    }
    if (err instanceof StepLockedAfterApprovalError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

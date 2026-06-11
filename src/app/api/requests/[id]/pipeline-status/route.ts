import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import {
  clipRequestRepository,
  uploadedAssetRepository,
  videoGenerationJobRepository,
} from "@/repositories/index";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";
import * as klingService from "@/lib/ai/klingService";

/**
 * GET /api/requests/[id]/pipeline-status
 *
 * Returns the current pipeline step for the requester's job.
 * Used by PipelineStatusPoller to detect step changes.
 *
 * - GeneratingBaseVideo: polls Kling and delegates to checkBaseVideoReady on completion.
 * - GeneratingVoice: no polling needed — ElevenLabs synthesis runs inline on the
 *   server and advances the job itself; this route just reports the current step.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  if (session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const clipRequest = await clipRequestRepository.findById(id);
  if (!clipRequest || clipRequest.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let job = await videoGenerationJobRepository.findByRequestId(id);
  if (!job) {
    return NextResponse.json({ currentStep: null, failedAtStep: null, jobId: null });
  }

  // Kling: track live sub-status even if DB update fails
  let liveKlingStatus: "submitted" | "processing" | null = null;
  let liveKlingLastPolledAt: Date | null = null;

  if (job.currentStep === VideoGenerationStep.GeneratingBaseVideo && job.klingTaskId) {
    try {
      const klingResult = await klingService.pollTaskStatus(job.klingTaskId);
      console.log(`[pipeline-status] kling task=${job.klingTaskId} status=${klingResult.status} requestId=${id}`);

      if (klingResult.status === "submitted" || klingResult.status === "processing") {
        liveKlingStatus = klingResult.status;
        liveKlingLastPolledAt = new Date();
        videoGenerationJobRepository
          .update(job.id, { klingStatus: klingResult.status, klingLastPolledAt: liveKlingLastPolledAt })
          .catch((err) => console.error("[pipeline-status] DB klingStatus update failed:", err));
      } else {
        // "succeed" or "failed" - delegate full side effects
        try {
          job = await videoGenerationService.checkBaseVideoReady(job.id);
        } catch (err) {
          console.error("[pipeline-status] checkBaseVideoReady failed:", err);
        }
      }
    } catch (err) {
      console.error("[pipeline-status] Kling poll failed:", err);
    }
  }

  // Voice generation (ElevenLabs) runs inline server-side — no polling here.
  const voiceError: string | null = null;

  const processedVoiceAsset = job.processedVoiceAssetId
    ? await uploadedAssetRepository.findById(job.processedVoiceAssetId)
    : null;

  return NextResponse.json(
    {
      currentStep: job.currentStep,
      failedAtStep: job.failedAtStep,
      jobId: job.id,
      voiceError,
      processedVoiceAssetId: job.processedVoiceAssetId,
      processedVoiceUrl: processedVoiceAsset?.storageUrl ?? null,
      klingStatus: liveKlingStatus ?? job.klingStatus ?? null,
      klingLastPolledAt: (liveKlingLastPolledAt ?? job.klingLastPolledAt)?.toISOString() ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

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
import { videoGenerationService } from "@/services/VideoGenerationService";

/**
 * GET /api/requests/[id]/pipeline-status
 *
 * Returns the current pipeline step for the requester's job.
 * Used by PipelineStatusPoller to detect step changes.
 *
 * - GeneratingBaseVideo: polls Veo and delegates to checkBaseVideoReady on completion.
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

  // Phase 3: Veo runs one cumulative scene task at a time. Polling and
  // downloading are handled inside checkBaseVideoReady, which advances to the
  // review gate after each cumulative scene output is ready.
  const hasVideoGenTasks = (job.videoGenTaskIds && job.videoGenTaskIds.length > 0) || !!job.videoGenTaskId;
  if (job.currentStep === VideoGenerationStep.GeneratingBaseVideo && hasVideoGenTasks) {
    try {
      job = await videoGenerationService.checkBaseVideoReady(job.id);
    } catch (err) {
      console.error("[pipeline-status] checkBaseVideoReady failed:", err);
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
      videoGenStatus: job.videoGenStatus ?? null,
      videoGenLastPolledAt: job.videoGenLastPolledAt?.toISOString() ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

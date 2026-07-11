import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import {
  clipRequestRepository,
  uploadedAssetRepository,
  videoGenerationJobRepository,
} from "@/repositories/index";

/**
 * GET /api/requests/[id]/pipeline-status
 *
 * Returns the current pipeline step for the requester's job.
 * Used by PipelineStatusPoller to detect step changes.
 *
 * - GeneratingBaseVideo: the montage segment renders in a background task that
 *   advances the job itself; this route just reports the current step.
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

  // The montage engine renders each scene segment in a background task that
  // advances the step itself, so there is nothing to poll here — the poller
  // simply reads the current step below.

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
      // Phase 7 — background Travy render status, so the poller can keep the
      // Travy spinner live while the job is already Complete.
      tventVideoStatus: job.tventVideoStatus ?? "idle",
      tventVideoError: job.tventVideoError ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

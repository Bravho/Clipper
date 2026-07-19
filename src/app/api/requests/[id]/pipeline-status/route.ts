import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import {
  clipRequestRepository,
  uploadedAssetRepository,
  videoGenerationJobRepository,
} from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import { isJobStalled } from "@/config/stallThresholds";

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

  // Safety net: if a worker marked the render claim failed but never advanced the
  // job step, surface the failure here instead of letting the poller spin forever.
  // No-op unless renderState === "failed" (legitimate long renders keep loading).
  job = await videoGenerationService.reconcileFailedRender(job);

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
      // A job stranded on a processing step (interrupted inline render / abandoned
      // claim) past its generous per-step threshold. The page uses this to offer a
      // manual retry instead of spinning forever. Never auto-fails.
      stalled: isJobStalled(job),
      voiceError,
      processedVoiceAssetId: job.processedVoiceAssetId,
      processedVoiceUrl: processedVoiceAsset?.storageUrl ?? null,
      videoGenStatus: job.videoGenStatus ?? null,
      videoGenLastPolledAt: job.videoGenLastPolledAt?.toISOString() ?? null,
      // Progressive per-ratio reveal: the compose step (_runFFmpegComposition)
      // now advances the job to AwaitingFinalApproval as soon as the FIRST
      // (primary) ratio uploads, then persists each remaining ratio's
      // finalExport_* field as it lands. These ids are exposed so the poller can
      // refresh incrementally as more ratios appear (see the `revealRatios` prop
      // on PipelineStatusPoller) — additive fields only, so the existing
      // contract is unchanged.
      finalExports: {
        "9:16": job.finalExport_9_16_assetId ?? null,
        "16:9": job.finalExport_16_9_assetId ?? null,
        "1:1": job.finalExport_1_1_assetId ?? null,
        "4:5": job.finalExport_4_5_assetId ?? null,
      },
      // Progressive per-channel reveal (GeneratingAdditionalRatios): each ratio's
      // CAPTIONED export id is persisted the instant that ratio finishes
      // (`_runAdditionalRatiosOverlay` writes per-iteration). Exposing them lets
      // the poller refresh as each channel's video lands, so finished channels
      // are playable while the rest keep rendering. Additive field.
      captionedExports: {
        "9:16": job.captionedExport_9_16_assetId ?? null,
        "16:9": job.captionedExport_16_9_assetId ?? null,
        "1:1": job.captionedExport_1_1_assetId ?? null,
        "4:5": job.captionedExport_4_5_assetId ?? null,
      },
      // Per-step % (0–100; null = not measurable → the UI keeps its spinner) and
      // which unit of a multi-part step is rendering. Additive fields.
      renderProgress: job.renderProgress ?? null,
      renderProgressDetail: job.renderProgressDetail ?? null,
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

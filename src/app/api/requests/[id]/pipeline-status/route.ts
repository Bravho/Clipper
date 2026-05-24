import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";
import * as klingService from "@/lib/ai/klingService";

/**
 * GET /api/requests/[id]/pipeline-status
 *
 * Returns the current pipeline step for the requester's job.
 * Used by PipelineStatusPoller to detect step changes and trigger
 * a page navigation when the pipeline advances or fails.
 *
 * For the Kling step (GeneratingBaseVideo) this route polls Kling directly
 * so it always returns the live sub-status even if the DB update fails.
 * When Kling reports "succeed" or "failed", full side effects (download,
 * asset creation, step advance) are delegated to checkBaseVideoReady.
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

  // Track live Kling status separately so we always return the freshest value
  // even when the DB update that persists it throws.
  let liveKlingStatus: "submitted" | "processing" | null = null;
  let liveKlingLastPolledAt: Date | null = null;

  if (job.currentStep === VideoGenerationStep.GeneratingBaseVideo && job.klingTaskId) {
    try {
      const klingResult = await klingService.pollTaskStatus(job.klingTaskId);
      console.log(`[pipeline-status] task=${job.klingTaskId} status=${klingResult.status} requestId=${id}`);

      if (klingResult.status === "submitted" || klingResult.status === "processing") {
        liveKlingStatus = klingResult.status;
        liveKlingLastPolledAt = new Date();
        // Persist best-effort — a failure here must not suppress the live value above.
        videoGenerationJobRepository
          .update(job.id, { klingStatus: klingResult.status, klingLastPolledAt: liveKlingLastPolledAt })
          .catch((err) => console.error("[pipeline-status] DB klingStatus update failed:", err));
      } else {
        // "succeed" or "failed" — delegate download / asset creation / step advance.
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

  return NextResponse.json({
    currentStep: job.currentStep,
    failedAtStep: job.failedAtStep,
    jobId: job.id,
    klingStatus: liveKlingStatus ?? job.klingStatus ?? null,
    klingLastPolledAt: (liveKlingLastPolledAt ?? job.klingLastPolledAt)?.toISOString() ?? null,
  });
}

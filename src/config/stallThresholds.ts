import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { RENDER_QUEUE } from "@/config/renderQueue";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import type { RenderTask } from "@/domain/models/RenderTask";

/**
 * How long a job may sit on a given "processing" step before the requester page
 * offers a manual retry ("taking longer than expected"). These are deliberately
 * GENEROUS — longer than the worst observed run for that step — because crossing
 * the threshold never auto-fails the job; it only *reveals a retry button*. A
 * legitimately slow render just keeps showing "loading" until it finishes or the
 * user chooses to retry. Compose is the long pole (~16 min observed), so its
 * window is the widest.
 *
 * A step not listed here is not a background-processing step (it's a review gate
 * or terminal state), so it can never be "stalled".
 */
export const PROCESSING_STEP_TIMEOUT_SECONDS: Partial<
  Record<VideoGenerationStep, number>
> = {
  [VideoGenerationStep.AnalyzingContent]: 5 * 60,
  [VideoGenerationStep.GeneratingVoice]: 5 * 60,
  [VideoGenerationStep.GeneratingSceneDesign]: 5 * 60,
  [VideoGenerationStep.GeneratingBaseVideo]: 15 * 60,
  [VideoGenerationStep.MergingScenes]: 15 * 60,
  [VideoGenerationStep.GeneratingAnimations]: 5 * 60,
  [VideoGenerationStep.ComposingFinalVideo]: 25 * 60,
  [VideoGenerationStep.GeneratingOverlay]: 8 * 60,
  [VideoGenerationStep.GeneratingAdditionalRatios]: 15 * 60,
};

/** Steps a stalled-retry may resume from (mirrors the timeout table keys). */
export const STALLABLE_STEPS: VideoGenerationStep[] = Object.keys(
  PROCESSING_STEP_TIMEOUT_SECONDS
) as VideoGenerationStep[];

/**
 * True when a job has been sitting on a processing step longer than its threshold
 * AND no worker is actively making progress on it. Pure and side-effect free, so
 * both the status API and the server-rendered page can call it.
 *
 * "Actively making progress" = the job has an ACTIVE render task (queued/claimed)
 * on the FIFO line whose keep-alive (heartbeat, else claim time) is newer than the
 * stale-claim window. That protects a genuinely long worker render (fresh
 * heartbeats) from ever looking stalled. An INLINE render (no worker) has no task,
 * so once past the threshold it correctly surfaces as stalled — as does a task
 * whose worker crashed (keep-alive gone stale). Pass `activeTask` from
 * `renderTaskRepository.findActiveByJob(job.id)` (null when none).
 */
export function isJobStalled(
  job: Pick<VideoGenerationJob, "currentStep" | "stepStartedAt" | "updatedAt">,
  activeTask?: Pick<RenderTask, "state" | "heartbeatAt" | "claimedAt"> | null,
  now: number = Date.now()
): boolean {
  const timeoutSeconds = PROCESSING_STEP_TIMEOUT_SECONDS[job.currentStep];
  if (timeoutSeconds == null) return false; // not a processing step

  // A worker actively rendering (fresh keep-alive) is making progress → not stalled.
  if (activeTask && (activeTask.state === "queued" || activeTask.state === "claimed")) {
    const keepAlive = activeTask.heartbeatAt ?? activeTask.claimedAt;
    if (keepAlive && now - keepAlive.getTime() < RENDER_QUEUE.staleClaimSeconds * 1000) {
      return false;
    }
  }

  const startedAt = job.stepStartedAt ?? job.updatedAt;
  if (!startedAt) return false;
  return now - startedAt.getTime() > timeoutSeconds * 1000;
}

import { RenderStep } from "@/domain/enums/RenderStep";

/**
 * One enqueued heavy pipeline step waiting for (or running on) the Mac Mini
 * render worker.
 *
 * The queue is a single flat FIFO line of these tasks, mixed across every
 * requester — e.g. #1 user B's overlay render, #2 user A's merge, #3 user C's
 * compose. A video puts a NEW task into the line each time it clears an approval
 * gate and reaches its next heavy step; at most one active (queued/claimed) task
 * exists per job at a time (approval gates serialise a job's steps).
 *
 * This replaces the single mutable render_* columns that migration 010 added to
 * video_generation_jobs: those could only represent one queued step per job with
 * no global ordering, no honest position, and no duration history.
 */
export type RenderTaskState = "queued" | "claimed" | "done" | "failed";

export interface RenderTask {
  id: string;
  /** The pipeline job this step belongs to. */
  jobId: string;
  /** The clip request the job is producing (for admin drill-down + UI mapping). */
  requestId: string;
  /**
   * The requesting user (clip_requests.user_id), denormalised at enqueue time so
   * the worker log can name whose step it is without a join. Never surfaced to
   * other requesters — the requester UI only ever shows a position COUNT.
   */
  requesterId: string | null;
  /** Which heavy step to run (dispatched via VideoGenerationService.runQueuedRenderStep). */
  step: RenderStep;
  /** Optional args for the step, e.g. `{ sceneIndex: 2 }`. */
  payload: Record<string, unknown> | null;
  state: RenderTaskState;
  /** How many times this step has been claimed (crash reclaims increment it). */
  attempts: number;
  /**
   * Base ranking, from what the requester has paid (see `RENDER_PRIORITY` in
   * src/config/renderQueue.ts). Higher is served sooner. The line is ordered by
   * this PLUS an ageing bonus that grows with time waited, so a low priority
   * delays a task rather than stranding it.
   */
  priority: number;
  /**
   * This step's source media lives only on the requester's device.
   *
   * The Mac Mini worker's claim scan excludes these rows. That is not an
   * optimisation — the worker has no copy of the footage, so claiming one could
   * only end in a failed step and a refunded allowance. Keeping the exclusion
   * in the CLAIM rather than in a check inside the step means the failure is
   * impossible rather than merely handled.
   *
   * False for every row that existed before migration 036 and for every
   * server-path request, so the existing queue behaves exactly as it did.
   */
  deviceOnly: boolean;
  /**
   * Tie-break ordering key within a priority, and the input to the ageing bonus
   * — set once at enqueue, never bumped.
   */
  enqueuedAt: Date;
  claimedBy: string | null;
  claimedAt: Date | null;
  /** Worker keep-alive while a long render runs; stale-claim reclaim reads this. */
  heartbeatAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Wall-clock of the finished step, for the admin monitor / duration profile. */
  durationMs: number | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueRenderTaskInput {
  jobId: string;
  requestId: string;
  requesterId?: string | null;
  step: RenderStep;
  payload?: Record<string, unknown> | null;
  /**
   * Base ranking. Omit for the lowest (0) — callers that know the request should
   * pass `renderPriorityForRequest(request)` from src/config/renderQueue.ts.
   */
  priority?: number;
  /**
   * Set true when the request's originals are device-held, so only the phone
   * that has them can run this step. Omit for the normal server path.
   */
  deviceOnly?: boolean;
}

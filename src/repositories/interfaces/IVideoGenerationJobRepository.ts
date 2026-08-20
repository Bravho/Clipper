import {
  VideoGenerationJob,
  CreateVideoGenerationJobInput,
  UpdateVideoGenerationJobInput,
  VideoGenerationStepHistoryEntry,
} from "@/domain/models/VideoGenerationJob";
import type {
  GateActorSource,
  GateResolution,
} from "@/services/analytics/GateEventService";

/**
 * Who asked for a step transition, for the `pipeline_gate_events` analytics row
 * the update writes (migration 028).
 *
 * OPTIONAL by design. The express lane reuses a real requester's id when it
 * auto-approves (so the `*_approved_by` columns are never blanked), which makes
 * an auto-approval indistinguishable from a human click everywhere else in the
 * schema — this is the only place the difference is recorded. It stays optional
 * so the ~100 existing `update()` call sites keep compiling unchanged; an
 * unpassed actor simply records a null one.
 */
export interface JobUpdateActor {
  /** The user the action is attributed to, when there is one. */
  userId?: string;
  source: GateActorSource;
  /**
   * Overrides the resolution inferred from the step transition. Needed because
   * "approved" and "revised" can leave a gate for the same next step, which the
   * repository cannot tell apart from the step values alone.
   */
  resolution?: GateResolution;
}

export interface IVideoGenerationJobRepository {
  findById(id: string): Promise<VideoGenerationJob | null>;
  findByRequestId(requestId: string): Promise<VideoGenerationJob | null>;
  create(input: CreateVideoGenerationJobInput): Promise<VideoGenerationJob>;
  update(
    id: string,
    input: UpdateVideoGenerationJobInput,
    actor?: JobUpdateActor
  ): Promise<VideoGenerationJob>;
  /** Immutable audit log of every pipeline step the job entered, oldest first. */
  listStepHistory(jobId: string): Promise<VideoGenerationStepHistoryEntry[]>;

  // ── Render-queue seam (Mac Mini worker offload) ─────────────────────────────

  /** Record/refresh a worker's liveness heartbeat (upsert by workerId). */
  recordWorkerHeartbeat(workerId: string): Promise<void>;

  /** True if any worker heartbeat is newer than `freshSeconds` ago. */
  isRenderWorkerAlive(freshSeconds: number): Promise<boolean>;

  /**
   * Atomically claim one queued (or stale-claimed) render step for `workerId`.
   * Postgres uses `SELECT … FOR UPDATE SKIP LOCKED` so concurrent workers never
   * grab the same job. Returns the claimed job, or null if nothing is queued.
   * A claim is reclaimable when its keep-alive is older than `staleClaimSeconds`.
   */
  claimNextQueuedRenderStep(
    workerId: string,
    staleClaimSeconds: number
  ): Promise<VideoGenerationJob | null>;

  /** Worker keep-alive: bump `render_heartbeat_at` on an in-flight claim. */
  touchRenderClaim(jobId: string): Promise<void>;

  /** Mark a claim finished: 'done' on success, 'failed' otherwise. */
  completeRenderClaim(jobId: string, state: "done" | "failed"): Promise<void>;
}

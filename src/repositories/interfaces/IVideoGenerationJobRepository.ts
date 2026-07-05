import {
  VideoGenerationJob,
  CreateVideoGenerationJobInput,
  UpdateVideoGenerationJobInput,
  VideoGenerationStepHistoryEntry,
} from "@/domain/models/VideoGenerationJob";

export interface IVideoGenerationJobRepository {
  findById(id: string): Promise<VideoGenerationJob | null>;
  findByRequestId(requestId: string): Promise<VideoGenerationJob | null>;
  create(input: CreateVideoGenerationJobInput): Promise<VideoGenerationJob>;
  update(id: string, input: UpdateVideoGenerationJobInput): Promise<VideoGenerationJob>;
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

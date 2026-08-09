import {
  RenderTask,
  RenderTaskState,
  EnqueueRenderTaskInput,
} from "@/domain/models/RenderTask";

/**
 * Data access for the flat FIFO render-task queue processed by the Mac Mini
 * worker. Mirrors the atomic-claim / heartbeat contract the old single-row seam
 * used (see IVideoGenerationJobRepository), now against the render_tasks table.
 */
export interface IRenderTaskRepository {
  /**
   * Add one heavy step to the back of the FIFO line. Idempotent per job: if the
   * job already has an active (queued/claimed) task it is REPLACED rather than
   * stacked, so a re-dispatch never double-queues the same job's work.
   */
  enqueue(input: EnqueueRenderTaskInput): Promise<RenderTask>;

  /**
   * Atomically claim the OLDEST queued task (or a claimed one whose keep-alive
   * has gone stale — a crashed worker), skipping rows another worker has locked.
   * Postgres uses `... FOR UPDATE SKIP LOCKED` so concurrent workers never grab
   * the same task. Returns the claimed task, or null if the line is empty.
   */
  claimNext(
    workerId: string,
    staleClaimSeconds: number
  ): Promise<RenderTask | null>;

  /** Worker keep-alive: bump `heartbeat_at` on an in-flight claim. */
  touch(taskId: string): Promise<void>;

  /**
   * Mark a claim finished. 'done' or 'failed'. Records finished_at and, on the
   * first completion, duration_ms (started_at → now). `error` is stored on fail.
   */
  complete(
    taskId: string,
    state: Extract<RenderTaskState, "done" | "failed">,
    error?: string | null
  ): Promise<void>;

  /**
   * Release an in-flight claim back to 'queued' (graceful-shutdown drain) WITHOUT
   * losing its FIFO position — enqueued_at is preserved so it is re-claimed next.
   */
  release(taskId: string): Promise<void>;

  /** The active (queued/claimed) task for a job, if any. */
  findActiveByJob(jobId: string): Promise<RenderTask | null>;

  /** The active (queued/claimed) task for a request, if any. */
  findActiveByRequest(requestId: string): Promise<RenderTask | null>;

  /**
   * How many active tasks sit AHEAD of the given task in the FIFO line (strictly
   * older enqueued_at, still queued/claimed). This is the honest number shown to
   * a requester: 0 = next up / rendering now. Returns null if the task is not
   * active (finished or unknown).
   */
  countAhead(taskId: string): Promise<number | null>;

  /**
   * The full active line, oldest first — for the admin monitor. Includes the
   * claimed (currently-rendering) task(s) at the front.
   */
  listActive(): Promise<RenderTask[]>;

  /**
   * The most recently created task for a job regardless of state — used by the
   * failed-render reconcile net (was a step marked failed but the job left on a
   * processing step?) and admin drill-down. Null if the job has no tasks.
   */
  findLatestByJob(jobId: string): Promise<RenderTask | null>;
}

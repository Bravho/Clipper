import { IRenderTaskRepository } from "@/repositories/interfaces/IRenderTaskRepository";
import {
  RenderTask,
  RenderTaskState,
  EnqueueRenderTaskInput,
} from "@/domain/models/RenderTask";
import { RenderStep } from "@/domain/enums/RenderStep";
import { RENDER_QUEUE } from "@/config/renderQueue";
import { pool } from "@/lib/db";

/**
 * The effective-priority expression the whole line is ordered by: base priority
 * plus a bonus for each whole hour waited, capped.
 *
 * It has to be computed in SQL because `claimNext` orders and locks in one
 * statement. `effectiveRenderPriority()` in src/config/renderQueue.ts is the
 * same formula in TypeScript for the mock repository — if you change one, change
 * both, or the position shown to a requester stops matching what renders next.
 *
 * `$cap` and `$perHour` are bound as parameters so the knobs stay in config.
 */
function effectivePriorityExpr(alias: string, capParam: string, perHourParam: string): string {
  return `(${alias}.priority + LEAST(${capParam}::numeric, FLOOR(EXTRACT(EPOCH FROM (NOW() - ${alias}.enqueued_at)) / 3600) * ${perHourParam}::numeric))`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toDate(value: unknown): Date | null {
  return value ? new Date(value as string) : null;
}

function rowToTask(row: Record<string, unknown>): RenderTask {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    requestId: row.request_id as string,
    requesterId: (row.requester_id as string) ?? null,
    step: row.step as RenderStep,
    payload: parseJson<Record<string, unknown> | null>(row.payload, null),
    state: row.state as RenderTaskState,
    attempts: Number(row.attempts ?? 0),
    priority: Number(row.priority ?? 0),
    enqueuedAt: new Date(row.enqueued_at as string),
    claimedBy: (row.claimed_by as string) ?? null,
    claimedAt: toDate(row.claimed_at),
    heartbeatAt: toDate(row.heartbeat_at),
    startedAt: toDate(row.started_at),
    finishedAt: toDate(row.finished_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    error: (row.error as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresRenderTaskRepository implements IRenderTaskRepository {
  constructor(private db = pool) {}

  async enqueue(input: EnqueueRenderTaskInput): Promise<RenderTask> {
    // Idempotent per job: at most one ACTIVE task per job (uq_render_tasks_active_job,
    // a partial unique index over state IN ('queued','claimed')). A re-dispatch
    // therefore REPLACES the job's active task in place — resetting it to a fresh
    // queued step at the BACK of the line (new enqueued_at) — rather than stacking
    // a second row. Done atomically via ON CONFLICT so there is no delete/insert
    // race. Steps are serialised by approval gates, so this realistically only
    // fires when retrying the same step.
    const { rows } = await this.db.query(
      `INSERT INTO render_tasks (job_id, request_id, requester_id, step, payload, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_id) WHERE state IN ('queued', 'claimed')
       DO UPDATE SET
         request_id   = EXCLUDED.request_id,
         requester_id = EXCLUDED.requester_id,
         step         = EXCLUDED.step,
         payload      = EXCLUDED.payload,
         priority     = EXCLUDED.priority,
         state        = 'queued',
         attempts     = 0,
         enqueued_at  = NOW(),
         claimed_by   = NULL,
         claimed_at   = NULL,
         heartbeat_at = NULL,
         started_at   = NULL,
         finished_at  = NULL,
         duration_ms  = NULL,
         error        = NULL,
         updated_at   = NOW()
       RETURNING *`,
      [
        input.jobId,
        input.requestId,
        input.requesterId ?? null,
        input.step,
        input.payload == null ? null : JSON.stringify(input.payload),
        input.priority ?? 0,
      ]
    );
    return rowToTask(rows[0]);
  }

  async claimNext(
    workerId: string,
    staleClaimSeconds: number
  ): Promise<RenderTask | null> {
    const { rows } = await this.db.query(
      `WITH next AS (
         SELECT id FROM render_tasks
          WHERE state = 'queued'
             OR (state = 'claimed'
                 AND COALESCE(heartbeat_at, claimed_at)
                     < NOW() - ($2 || ' seconds')::interval)
          ORDER BY ${effectivePriorityExpr("render_tasks", "$3", "$4")} DESC,
                   enqueued_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE render_tasks t
          SET state       = 'claimed',
              claimed_by  = $1,
              claimed_at  = NOW(),
              heartbeat_at = NOW(),
              started_at  = COALESCE(t.started_at, NOW()),
              attempts    = t.attempts + 1,
              updated_at  = NOW()
         FROM next
        WHERE t.id = next.id
       RETURNING t.*`,
      [
        workerId,
        String(staleClaimSeconds),
        RENDER_QUEUE.agingCapPoints,
        RENDER_QUEUE.agingPointsPerHour,
      ]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async claimForDevice(taskId: string, requesterId: string, deviceClaimId: string): Promise<RenderTask | null> {
    const { rows } = await this.db.query(
      `UPDATE render_tasks
          SET state = 'claimed', claimed_by = $3, claimed_at = NOW(),
              heartbeat_at = NOW(), started_at = COALESCE(started_at, NOW()),
              attempts = attempts + 1, updated_at = NOW()
        WHERE id = $1 AND requester_id = $2 AND state = 'queued'
          AND step = 'overlay_composition'
       RETURNING *`,
      [taskId, requesterId, deviceClaimId]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async touchClaim(taskId: string, deviceClaimId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE render_tasks SET heartbeat_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND claimed_by = $2 AND state = 'claimed'`,
      [taskId, deviceClaimId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async completeClaim(taskId: string, deviceClaimId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE render_tasks
          SET state = 'done', finished_at = NOW(),
              duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::bigint,
              updated_at = NOW()
        WHERE id = $1 AND claimed_by = $2 AND state = 'claimed'`,
      [taskId, deviceClaimId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async releaseClaim(taskId: string, deviceClaimId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE render_tasks
          SET state = 'queued', claimed_by = NULL, claimed_at = NULL,
              heartbeat_at = NULL, updated_at = NOW()
        WHERE id = $1 AND claimed_by = $2 AND state = 'claimed'`,
      [taskId, deviceClaimId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async touch(taskId: string): Promise<void> {
    await this.db.query(
      `UPDATE render_tasks
          SET heartbeat_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND state = 'claimed'`,
      [taskId]
    );
  }

  async complete(
    taskId: string,
    state: Extract<RenderTaskState, "done" | "failed">,
    error?: string | null
  ): Promise<void> {
    await this.db.query(
      `UPDATE render_tasks
          SET state       = $2,
              finished_at = NOW(),
              duration_ms = COALESCE(
                duration_ms,
                (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::bigint
              ),
              error       = $3,
              updated_at  = NOW()
        WHERE id = $1`,
      [taskId, state, error ?? null]
    );
  }

  async release(taskId: string): Promise<void> {
    await this.db.query(
      `UPDATE render_tasks
          SET state = 'queued', claimed_by = NULL, claimed_at = NULL,
              heartbeat_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [taskId]
    );
  }

  async findActiveByJob(jobId: string): Promise<RenderTask | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM render_tasks
        WHERE job_id = $1 AND state IN ('queued', 'claimed')
        ORDER BY enqueued_at LIMIT 1`,
      [jobId]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async findActiveByRequest(requestId: string): Promise<RenderTask | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM render_tasks
        WHERE request_id = $1 AND state IN ('queued', 'claimed')
        ORDER BY enqueued_at LIMIT 1`,
      [requestId]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async countAhead(taskId: string): Promise<number | null> {
    const { rows } = await this.db.query(
      // Counts tasks that would be CLAIMED first, not merely enqueued earlier:
      // with priorities in play those are different sets, and showing the second
      // one would tell a requester they are 3rd when they are really 11th.
      `WITH target AS (
         SELECT id, priority, enqueued_at FROM render_tasks
          WHERE id = $1 AND state IN ('queued', 'claimed')
       )
       SELECT
         EXISTS (SELECT 1 FROM target) AS active,
         (SELECT COUNT(*)::int
            FROM render_tasks r, target t
           WHERE r.state IN ('queued', 'claimed')
             AND r.id <> t.id
             AND (
               ${effectivePriorityExpr("r", "$2", "$3")}
                 > ${effectivePriorityExpr("t", "$2", "$3")}
               OR (
                 ${effectivePriorityExpr("r", "$2", "$3")}
                   = ${effectivePriorityExpr("t", "$2", "$3")}
                 AND r.enqueued_at < t.enqueued_at
               )
             )) AS ahead`,
      [taskId, RENDER_QUEUE.agingCapPoints, RENDER_QUEUE.agingPointsPerHour]
    );
    const row = rows[0];
    if (!row || !row.active) return null;
    return Number(row.ahead ?? 0);
  }

  async listActive(): Promise<RenderTask[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM render_tasks
        WHERE state IN ('queued', 'claimed')
        ORDER BY ${effectivePriorityExpr("render_tasks", "$1", "$2")} DESC,
                 enqueued_at ASC`,
      [RENDER_QUEUE.agingCapPoints, RENDER_QUEUE.agingPointsPerHour]
    );
    return rows.map(rowToTask);
  }

  async findLatestByJob(jobId: string): Promise<RenderTask | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM render_tasks
        WHERE job_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [jobId]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }
}

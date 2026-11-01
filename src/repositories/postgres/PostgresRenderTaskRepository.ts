import { IRenderTaskRepository } from "@/repositories/interfaces/IRenderTaskRepository";
import {
  RenderTask,
  RenderTaskState,
  EnqueueRenderTaskInput,
} from "@/domain/models/RenderTask";
import { RenderStep } from "@/domain/enums/RenderStep";
import { RENDER_QUEUE } from "@/config/renderQueue";
import { isRenderLaneEnabled, isLineTestMode } from "@/config/reviewSystem";
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
    deviceOnly: Boolean(row.device_only),
    enqueuedAt: new Date(row.enqueued_at as string),
    claimedBy: (row.claimed_by as string) ?? null,
    claimedAt: toDate(row.claimed_at),
    heartbeatAt: toDate(row.heartbeat_at),
    startedAt: toDate(row.started_at),
    finishedAt: toDate(row.finished_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    error: (row.error as string) ?? null,
    renderLane: (row.render_lane as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Returns the pair of state values that represent "active" for the current
 * process mode: ('queued','claimed') for production, ('test_queued','test_claimed')
 * for LINE test mode. Used in SELECT filters and CASE expressions.
 */
function activeStateLiterals(): [string, string] {
  return isLineTestMode() ? ["test_queued", "test_claimed"] : ["queued", "claimed"];
}

export class PostgresRenderTaskRepository implements IRenderTaskRepository {
  constructor(private db = pool) {}

  private claimOwnershipPredicate(): string {
    return `EXISTS (SELECT 1 FROM clip_requests cr WHERE cr.id::text = render_tasks.request_id
      AND COALESCE(cr.is_test, FALSE) = ${isLineTestMode() ? 'TRUE' : 'FALSE'})`;
  }

  async enqueue(input: EnqueueRenderTaskInput): Promise<RenderTask> {
    const request = await this.db.query(
      `SELECT is_test FROM clip_requests WHERE id::text = $1`, [input.requestId]
    );
    if (!request.rows[0]) throw new Error("Render request not found");
    const isTest = request.rows[0].is_test === true;
    if (isLineTestMode() && !isTest) throw new Error("Test process cannot enqueue a non-test request");
    const laneEnabled = isRenderLaneEnabled() || isTest;
    const params: unknown[] = [input.jobId, input.requestId, input.requesterId ?? null,
      input.step, input.payload == null ? null : JSON.stringify(input.payload),
      input.priority ?? 0, input.deviceOnly ?? false, isTest ? 'test_queued' : 'queued'];
    if (laneEnabled) params.push(input.renderLane ?? null);
    // 058 enforces uniqueness across both namespaces, including concurrent inserts.
    // DO NOTHING can see conflicts invisible to its snapshot. Read in a fresh
    // statement, retrying boundedly if the competing task completes meanwhile.
    for (let attempt = 0; attempt < 3; attempt++) {
      const inserted = await this.db.query(
        `INSERT INTO render_tasks
           (job_id, request_id, requester_id, step, payload, priority, device_only, state${laneEnabled ? ', render_lane' : ''})
         SELECT $1, $2, $3, $4, $5, $6, $7, $8${laneEnabled ? ', $9' : ''}
          WHERE NOT EXISTS (SELECT 1 FROM render_tasks WHERE job_id = $1
            AND state IN ('queued', 'claimed', 'test_queued', 'test_claimed'))
         ON CONFLICT (job_id) WHERE state IN ('queued', 'claimed', 'test_queued', 'test_claimed')
         DO NOTHING RETURNING *`, params
      );
      if (inserted.rows[0]) return rowToTask(inserted.rows[0]);
      const existing = await this.db.query(
        `SELECT * FROM render_tasks WHERE job_id = $1
          AND state IN ('queued', 'claimed', 'test_queued', 'test_claimed')
          ORDER BY enqueued_at LIMIT 1`, [input.jobId]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_id !== input.requestId) throw new Error("Active render task belongs to another request");
        return rowToTask(existing.rows[0]);
      }
    }
    throw new Error("Render enqueue contention: retry limit exceeded");
  }

  async claimNext(
    workerId: string,
    staleClaimSeconds: number,
    lane?: string | null
  ): Promise<RenderTask | null> {
    if (isLineTestMode()) {
      // Test worker claims ONLY test-state tasks.
      // Production 'queued'/'claimed' tasks are invisible here; test tasks are
      // invisible to the non-test worker (which only sees state='queued').
      const { rows } = await this.db.query(
        `WITH next AS (
           SELECT id FROM render_tasks
            WHERE device_only = FALSE
              AND EXISTS (SELECT 1 FROM clip_requests cr WHERE cr.id::text = render_tasks.request_id
                AND COALESCE(cr.is_test, FALSE) = ${isLineTestMode() ? 'TRUE' : 'FALSE'})
              AND (state = 'test_queued'
               OR (state = 'test_claimed'
                   AND COALESCE(heartbeat_at, claimed_at)
                       < NOW() - ($2 || ' seconds')::interval))
            ORDER BY ${effectivePriorityExpr("render_tasks", "$3", "$4")} DESC,
                     enqueued_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE render_tasks t
            SET state        = 'test_claimed',
                claimed_by   = $1,
                claimed_at   = NOW(),
                heartbeat_at = NOW(),
                started_at   = COALESCE(t.started_at, NOW()),
                attempts     = t.attempts + 1,
                updated_at   = NOW()
           FROM next
          WHERE t.id = next.id
         RETURNING t.*`,
        [workerId, String(staleClaimSeconds), RENDER_QUEUE.agingCapPoints, RENDER_QUEUE.agingPointsPerHour]
      );
      return rows[0] ? rowToTask(rows[0]) : null;
    }

    if (!isRenderLaneEnabled()) {
      // Pre-migration-049 non-test claim SQL — no lane filtering.
      // Only matches state='queued' or stale state='claimed'; test_queued/
      // test_claimed are invisible to this path by construction.
      const { rows } = await this.db.query(
        `WITH next AS (
         SELECT id FROM render_tasks
          WHERE device_only = FALSE
              AND EXISTS (SELECT 1 FROM clip_requests cr WHERE cr.id::text = render_tasks.request_id
                AND COALESCE(cr.is_test, FALSE) = ${isLineTestMode() ? 'TRUE' : 'FALSE'})
            AND (state = 'queued'
             OR (state = 'claimed'
                 AND COALESCE(heartbeat_at, claimed_at)
                     < NOW() - ($2 || ' seconds')::interval))
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
        [workerId, String(staleClaimSeconds), RENDER_QUEUE.agingCapPoints, RENDER_QUEUE.agingPointsPerHour]
      );
      return rows[0] ? rowToTask(rows[0]) : null;
    }

    // Lane-enabled path:
    //   lane='operator_pc' → only claim tasks with render_lane='operator_pc' (Mar-PC worker)
    //   lane=null/undefined → Mac Mini: claim tasks where render_lane IS DISTINCT FROM 'operator_pc'
    const backup = lane === 'backup' || lane === 'operator_pc';
    const laneClause = backup ? `AND render_lane = 'mac_mini' AND (
      NOT EXISTS (SELECT 1 FROM render_lane_heartbeats WHERE lane = 'main'
        AND last_seen_at > NOW() - ($5 || ' seconds')::interval)
      OR enqueued_at < NOW() - ($6 || ' seconds')::interval)` :
      `AND render_lane IS DISTINCT FROM 'operator_device'`;
    const params: unknown[] = [workerId, String(staleClaimSeconds),
      RENDER_QUEUE.agingCapPoints, RENDER_QUEUE.agingPointsPerHour];
    if (backup) params.push(process.env.RENDER_MAIN_STALE_SECONDS ?? '90', process.env.RENDER_BACKUP_QUEUE_SECONDS ?? '600');
    const { rows } = await this.db.query(
      `WITH next AS (
         SELECT id FROM render_tasks
          WHERE device_only = FALSE
              AND EXISTS (SELECT 1 FROM clip_requests cr WHERE cr.id::text = render_tasks.request_id
                AND COALESCE(cr.is_test, FALSE) = ${isLineTestMode() ? 'TRUE' : 'FALSE'})
            ${laneClause}
            AND (state = 'queued'
             OR (state = 'claimed'
                 AND COALESCE(heartbeat_at, claimed_at)
                     < NOW() - ($2 || ' seconds')::interval))
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
      params
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async claimForDevice(
    taskId: string,
    requesterId: string,
    deviceClaimId: string,
    allowedSteps: RenderStep[]
  ): Promise<RenderTask | null> {
    if (allowedSteps.length === 0) return null;
    // `state = 'queued'` is the whole race guarantee: a task the worker has
    // already claimed is never handed to a phone, and the UPDATE is atomic, so
    // two devices cannot both believe they won.
    // Device claims only apply to production tasks (test tasks are not claimed
    // via devices — test LINE users are synthetic and have no physical device).
    const { rows } = await this.db.query(
      `UPDATE render_tasks
          SET state = 'claimed', claimed_by = $3, claimed_at = NOW(),
              heartbeat_at = NOW(), started_at = COALESCE(started_at, NOW()),
              attempts = attempts + 1, updated_at = NOW()
        WHERE id = $1 AND requester_id = $2 AND state = 'queued'
          AND ${isLineTestMode() ? 'FALSE' : this.claimOwnershipPredicate()}
          -- A device-only task exists BECAUSE its footage is on this
          -- requester's phone and nowhere else, so the eligible-step list
          -- (which exists to limit what a phone may opportunistically take
          -- from the worker) does not apply to it.
          AND (device_only = TRUE OR step = ANY($4::text[]))
       RETURNING *`,
      [taskId, requesterId, deviceClaimId, allowedSteps]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async touchClaim(taskId: string, deviceClaimId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE render_tasks SET heartbeat_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND claimed_by = $2 AND state = '${isLineTestMode() ? 'test_claimed' : 'claimed'}' AND ${this.claimOwnershipPredicate()}`,
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
        WHERE id = $1 AND claimed_by = $2 AND state = '${isLineTestMode() ? 'test_claimed' : 'claimed'}' AND ${this.claimOwnershipPredicate()}`,
      [taskId, deviceClaimId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async releaseClaim(taskId: string, deviceClaimId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE render_tasks
          SET state = CASE WHEN state = 'test_claimed' THEN 'test_queued' ELSE 'queued' END,
              claimed_by = NULL, claimed_at = NULL,
              heartbeat_at = NULL, updated_at = NOW()
        WHERE id = $1 AND claimed_by = $2 AND state = '${isLineTestMode() ? 'test_claimed' : 'claimed'}' AND ${this.claimOwnershipPredicate()}`,
      [taskId, deviceClaimId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async touch(taskId: string): Promise<void> {
    await this.db.query(
      `UPDATE render_tasks
          SET heartbeat_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND state = '${isLineTestMode() ? 'test_claimed' : 'claimed'}' AND ${this.claimOwnershipPredicate()}`,
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
        WHERE id = $1 AND state = '${isLineTestMode() ? 'test_claimed' : 'claimed'}'
          AND ${this.claimOwnershipPredicate()}`,
      [taskId, state, error ?? null]
    );
  }

  async release(taskId: string): Promise<void> {
    // Preserve test state: test_claimed → test_queued, claimed → queued.
    // The render worker calls this on shutdown for its in-flight tasks; using
    // CASE ensures the task lands in the right namespace for its next claim.
    await this.db.query(
      `UPDATE render_tasks
          SET state = CASE WHEN state = 'test_claimed' THEN 'test_queued' ELSE 'queued' END,
              claimed_by   = NULL,
              claimed_at   = NULL,
              heartbeat_at = NULL,
              updated_at   = NOW()
        WHERE id = $1 AND state = '${isLineTestMode() ? 'test_claimed' : 'claimed'}'
          AND ${this.claimOwnershipPredicate()}`,
      [taskId]
    );
  }

  async findActiveByJob(jobId: string): Promise<RenderTask | null> {
    const [stateA, stateB] = activeStateLiterals();
    const { rows } = await this.db.query(
      `SELECT * FROM render_tasks
        WHERE job_id = $1 AND state IN ($2, $3)
        ORDER BY enqueued_at LIMIT 1`,
      [jobId, stateA, stateB]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async findActiveByRequest(requestId: string): Promise<RenderTask | null> {
    const [stateA, stateB] = activeStateLiterals();
    const { rows } = await this.db.query(
      `SELECT * FROM render_tasks
        WHERE request_id = $1 AND state IN ($2, $3)
        ORDER BY enqueued_at LIMIT 1`,
      [requestId, stateA, stateB]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async countAhead(taskId: string): Promise<number | null> {
    const [stateA, stateB] = activeStateLiterals();
    const { rows } = await this.db.query(
      // Counts tasks that would be CLAIMED first, not merely enqueued earlier:
      // with priorities in play those are different sets, and showing the second
      // one would tell a requester they are 3rd when they are really 11th.
      `WITH target AS (
         SELECT id, priority, enqueued_at FROM render_tasks
          WHERE id = $1 AND state IN ($4, $5)
       )
       SELECT
         EXISTS (SELECT 1 FROM target) AS active,
         (SELECT COUNT(*)::int
            FROM render_tasks r, target t
           WHERE r.state IN ($4, $5)
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
      [taskId, RENDER_QUEUE.agingCapPoints, RENDER_QUEUE.agingPointsPerHour, stateA, stateB]
    );
    const row = rows[0];
    if (!row || !row.active) return null;
    return Number(row.ahead ?? 0);
  }

  async listActive(): Promise<RenderTask[]> {
    const [stateA, stateB] = activeStateLiterals();
    const { rows } = await this.db.query(
      `SELECT * FROM render_tasks
        WHERE state IN ($3, $4)
        ORDER BY ${effectivePriorityExpr("render_tasks", "$1", "$2")} DESC,
                 enqueued_at ASC`,
      [RENDER_QUEUE.agingCapPoints, RENDER_QUEUE.agingPointsPerHour, stateA, stateB]
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

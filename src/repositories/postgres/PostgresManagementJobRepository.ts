/**
 * PostgreSQL implementation of the management job queue.
 *
 * Mirrors the render-queue claim seam (migration 010): claim with
 * `FOR UPDATE SKIP LOCKED`, heartbeat while working, reclaim a claim whose
 * worker has gone silent. No Redis, no broker — one table and Postgres's own
 * row locks.
 *
 * Every consumer must be idempotent: a reclaimed job can run twice, and provider
 * webhooks that enqueue jobs are delivered more than once.
 */

import { pool } from "@/lib/db";
import type {
  ManagementJob,
  EnqueueManagementJobInput,
} from "@/domain/models/ManagementJob";
import {
  ManagementJobKind,
  ManagementJobState,
} from "@/domain/enums/ManagementStatus";
import type { IManagementJobRepository } from "@/repositories/interfaces/IManagementPublicationRepositories";

type Row = Record<string, unknown>;

function rowToJob(row: Row): ManagementJob {
  return {
    id: row.id as string,
    kind: row.kind as ManagementJobKind,
    dedupeKey: row.dedupe_key as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    state: row.state as ManagementJobState,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: new Date(row.run_after as string),
    claimedBy: (row.claimed_by as string) ?? null,
    claimedAt: row.claimed_at ? new Date(row.claimed_at as string) : null,
    lastError: (row.last_error as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresManagementJobRepository implements IManagementJobRepository {
  constructor(private db = pool) {}

  async enqueue(
    input: EnqueueManagementJobInput
  ): Promise<{ job: ManagementJob; created: boolean }> {
    const inserted = await this.db.query(
      `INSERT INTO management_jobs (kind, dedupe_key, payload, run_after, max_attempts)
       VALUES ($1,$2,$3::jsonb,$4,$5)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING *`,
      [
        input.kind,
        input.dedupeKey,
        JSON.stringify(input.payload ?? {}),
        input.runAfter ?? new Date(),
        input.maxAttempts ?? 8,
      ]
    );
    if (inserted.rows[0]) {
      return { job: rowToJob(inserted.rows[0]), created: true };
    }

    const existing = await this.findByDedupeKey(input.dedupeKey);
    if (!existing) throw new Error("Management job could not be created or found.");
    return { job: existing, created: false };
  }

  async findById(id: string): Promise<ManagementJob | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_jobs WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async findByDedupeKey(dedupeKey: string): Promise<ManagementJob | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_jobs WHERE dedupe_key = $1",
      [dedupeKey]
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async claimNext(
    workerId: string,
    now: Date,
    staleClaimMs: number
  ): Promise<ManagementJob | null> {
    const staleBefore = new Date(now.getTime() - staleClaimMs);
    // One statement: find a runnable row (queued-and-due, or claimed-but-stale),
    // lock it against other workers, and flip it to claimed. SKIP LOCKED means a
    // second worker steps over a row already being claimed instead of blocking.
    const { rows } = await this.db.query(
      `UPDATE management_jobs
          SET state = $1,
              claimed_by = $2,
              claimed_at = $3,
              attempts = attempts + 1,
              updated_at = NOW()
        WHERE id = (
          SELECT id FROM management_jobs
           WHERE (state = $4 AND run_after <= $3)
              OR (state = $1 AND claimed_at < $5)
           ORDER BY run_after ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
      RETURNING *`,
      [
        ManagementJobState.Claimed,
        workerId,
        now,
        ManagementJobState.Queued,
        staleBefore,
      ]
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async heartbeat(id: string, workerId: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE management_jobs
          SET claimed_at = $3, updated_at = NOW()
        WHERE id = $1 AND claimed_by = $2 AND state = $4`,
      [id, workerId, now, ManagementJobState.Claimed]
    );
  }

  async complete(id: string): Promise<void> {
    await this.db.query(
      `UPDATE management_jobs
          SET state = $2, last_error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id, ManagementJobState.Done]
    );
  }

  async fail(
    id: string,
    error: string,
    opts: { retryable: boolean; backoffMs: number; now: Date }
  ): Promise<ManagementJob> {
    // Retryable and attempts left → re-queue with backoff. Otherwise terminal.
    const { rows } = await this.db.query(
      `UPDATE management_jobs
          SET state = CASE
                        WHEN $2 AND attempts < max_attempts THEN $3
                        ELSE $4
                      END,
              run_after = CASE
                            WHEN $2 AND attempts < max_attempts THEN $5
                            ELSE run_after
                          END,
              claimed_by = NULL,
              claimed_at = NULL,
              last_error = $6,
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [
        id,
        opts.retryable,
        ManagementJobState.Queued,
        ManagementJobState.Failed,
        new Date(opts.now.getTime() + opts.backoffMs),
        error.slice(0, 2000),
      ]
    );
    if (!rows[0]) throw new Error("Management job not found.");
    return rowToJob(rows[0]);
  }
}

import { ManagementJobKind, ManagementJobState } from "@/domain/enums/ManagementStatus";

/**
 * A unit of asynchronous management work.
 *
 * PostgreSQL → `management_jobs`.
 *
 * WHY A TABLE AND NOT A QUEUE RUNTIME. This mirrors the render-queue claim seam
 * (migration 010) rather than introducing Redis or a separate broker: a worker
 * claims a row, heartbeats while it works, and a stale claim is reclaimable, so
 * a crashed worker never wedges a job. Every job MUST be idempotent — provider
 * webhooks are delivered more than once, and a reclaim can run a job twice.
 *
 * `dedupeKey` is the natural key for the work (e.g. `reconcile:<publicationId>`)
 * and is UNIQUE, so enqueuing the same job twice collapses to one row instead of
 * doing the work twice.
 */
export interface ManagementJob {
  id: string;
  kind: ManagementJobKind;
  dedupeKey: string;
  payload: Record<string, unknown>;
  state: ManagementJobState;
  attempts: number;
  maxAttempts: number;
  /** Not eligible to run before this instant — drives exponential backoff. */
  runAfter: Date;
  claimedBy: string | null;
  claimedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueManagementJobInput {
  kind: ManagementJobKind;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  /** When the job first becomes runnable. Defaults to now. */
  runAfter?: Date;
  maxAttempts?: number;
}

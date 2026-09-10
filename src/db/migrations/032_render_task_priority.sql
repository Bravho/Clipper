-- Migration 032: Priority ranking for the render-task queue
--
-- WHY. One render costs 2–3 hours on a single worker (RENDER_CONCURRENCY
-- defaults to 1), so the line is the scarcest resource in the product. Under the
-- trial ladder (migration 031) most of the line is unpaid work: a plain FIFO
-- queue therefore makes paying customers wait behind free previews, which is
-- exactly backwards.
--
-- `priority` is the base rank, set at enqueue from what the requester has paid
-- (RENDER_PRIORITY in src/config/renderQueue.ts):
--   100  paid  — charged at submission, or a preview whose unlock was paid
--    50  free_clean   — the account's free, watermark-free first clip
--     0  free_preview — an unpaid watermarked preview
--
-- The line is NOT ordered by this column alone. Both the worker's claim and the
-- position count order by an effective priority = priority + an ageing bonus
-- that grows with time waited (capped). Without the ageing term, sustained paid
-- load would starve free work indefinitely, free requesters would churn, and the
-- acquisition ladder would stop working. The expression lives in
-- PostgresRenderTaskRepository.effectivePriorityExpr(), mirrored in TypeScript by
-- effectiveRenderPriority() for the mock repository.
--
-- Existing rows default to 0. That is the safe direction: an in-flight task is
-- briefly ranked as if unpaid rather than jumping ahead of real customers, and
-- the ageing bonus clears the backlog within hours.
--
-- Idempotent. Apply with:
--   node scripts/apply-migration.js src/db/migrations/032_render_task_priority.sql

ALTER TABLE render_tasks
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

-- The claim scan and every position count read the active line ordered by
-- (priority, enqueued_at). The old index was enqueued_at alone, which no longer
-- matches the leading sort key. Postgres cannot use an index for the full ageing
-- expression (it is NOW()-dependent and so not immutable), but a
-- (priority DESC, enqueued_at) index still narrows the scan to the active rows
-- in roughly the right order, and the active set is small by construction —
-- at most one task per in-flight job.
DROP INDEX IF EXISTS idx_render_tasks_active;
CREATE INDEX IF NOT EXISTS idx_render_tasks_active
  ON render_tasks (priority DESC, enqueued_at)
  WHERE state IN ('queued', 'claimed');

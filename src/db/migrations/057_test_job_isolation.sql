-- Migration 057: render_tasks test-job isolation indices
--
-- Required before the LINE Phase 2 test run (Mar-PC, LINE_TEST_MODE=true).
-- Must be applied AFTER 054 (is_test columns) and 049 (render_lane column).
--
-- PURPOSE
-- -------
-- The old Mac Mini render worker (deployed code before this branch) claims
-- render_tasks with SQL that only matches state IN ('queued','claimed').
-- To make test jobs invisible to that worker, new code (LINE_TEST_MODE=true)
-- enqueues test tasks with state='test_queued' and transitions them to
-- 'test_claimed' when claimed — values the old SQL never selects.
--
-- These indices mirror the two production indices (025_render_task_queue.sql)
-- for the test-state namespace:
--   uq_render_tasks_active_job   → uq_render_tasks_active_test_job
--   idx_render_tasks_active       → idx_render_tasks_test_active
--
-- The unique index is CRITICAL: without it, concurrent enqueues from the same
-- job could stack multiple 'test_queued' rows and the ON CONFLICT ... DO NOTHING
-- in the enqueue SQL would silently insert duplicates.
--
-- Additive and idempotent (IF NOT EXISTS). Never applied by the application.
-- Apply manually: node scripts/apply-migration.js src/db/migrations/057_test_job_isolation.sql

BEGIN;

-- Unique active-test-job guard — at most one test-active row per job.
-- Mirrors uq_render_tasks_active_job for test states.
CREATE UNIQUE INDEX IF NOT EXISTS uq_render_tasks_active_test_job
  ON render_tasks (job_id)
  WHERE state IN ('test_queued', 'test_claimed');

-- Partial index for the test-worker claim scan (ORDER BY enqueued_at).
-- Without this the claim query does a full table scan on the test-state rows.
CREATE INDEX IF NOT EXISTS idx_render_tasks_test_active
  ON render_tasks (enqueued_at)
  WHERE state IN ('test_queued', 'test_claimed');

COMMIT;

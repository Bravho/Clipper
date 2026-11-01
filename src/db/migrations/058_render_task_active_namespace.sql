-- One active task per job across production and test namespaces.
-- Additive: existing indices and rows are preserved. If historical duplicates
-- exist, creation fails; investigate them before retrying (no automatic cleanup).
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS uq_render_tasks_active_all_job
  ON render_tasks (job_id)
  WHERE state IN ('queued', 'claimed', 'test_queued', 'test_claimed');
COMMIT;

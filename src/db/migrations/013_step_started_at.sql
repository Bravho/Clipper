-- 013_step_started_at.sql
--
-- Track when a job entered its CURRENT step. This lets the requester UI detect a
-- job stranded on a "processing" step — e.g. an inline render interrupted by a
-- web-server restart, or an abandoned worker claim — where `render_state` is NOT
-- "failed" (so `reconcileFailedRender` can't catch it) and the page would
-- otherwise spin forever. When a job sits on a processing step past a generous
-- per-step threshold, the page offers a manual retry (it never auto-fails, so a
-- legitimately long render just keeps loading).
--
-- Auto-maintained by PostgresVideoGenerationJobRepository.update(): whenever an
-- update sets current_step, step_started_at is bumped to NOW().

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS step_started_at TIMESTAMPTZ;

-- Backfill existing rows from their last update (fall back to created_at) so they
-- don't all look freshly-started. Harmless either way: a genuinely-stalled legacy
-- row simply surfaces the retry option one threshold-window later.
UPDATE video_generation_jobs
  SET step_started_at = COALESCE(updated_at, created_at, NOW())
  WHERE step_started_at IS NULL;

ALTER TABLE video_generation_jobs
  ALTER COLUMN step_started_at SET DEFAULT NOW();
ALTER TABLE video_generation_jobs
  ALTER COLUMN step_started_at SET NOT NULL;

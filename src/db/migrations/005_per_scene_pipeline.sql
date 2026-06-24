-- Per-scene script-approval pipeline (Veo 3.1 video-extension model).
--
-- 1. current_scene_index: tracks which scene's per-scene script gate /
--    generation is active, driving the AwaitingSceneScriptApproval →
--    GeneratingBaseVideo → AwaitingVideoApproval loop.
-- 2. video_generation_step_history: immutable audit log of every pipeline
--    step a job entered (incl. each per-scene gate), so the full sequence is
--    preserved rather than only the latest current_step.

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS current_scene_index INT NOT NULL DEFAULT 0;

-- No FK on job_id: video_generation_jobs.id type varies across environments
-- (text vs uuid) and this is an append-only audit log, so referential
-- enforcement isn't needed. job_id is stored as text and holds the job's id
-- value regardless of the source column's type.
CREATE TABLE IF NOT EXISTS video_generation_step_history (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_id       TEXT NOT NULL,
  request_id   TEXT NOT NULL,
  step         TEXT NOT NULL,
  scene_index  INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vg_step_history_job_id
  ON video_generation_step_history(job_id);
CREATE INDEX IF NOT EXISTS idx_vg_step_history_request_id
  ON video_generation_step_history(request_id);

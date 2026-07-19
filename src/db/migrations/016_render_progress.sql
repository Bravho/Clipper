-- Migration 016: Per-step render progress (% display)
--
-- Additive and backwards-compatible. Adds throttled progress reporting for the
-- heavy generating steps so the requester UI can show a real % bar instead of a
-- bare spinner. NULL = unknown/not measurable (AI-API steps never write these);
-- the UI falls back to the existing spinner. Safe to run multiple times.
--
-- render_progress:        0..100 for the CURRENT generating step; reset to NULL
--                         whenever a heavy step is (re)dispatched.
-- render_progress_detail: optional JSON context for multi-unit steps, e.g.
--                         {"unit":"16:9","unitsDone":1,"unitsTotal":3}
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS render_progress        REAL;
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS render_progress_detail JSONB;

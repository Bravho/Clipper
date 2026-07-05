-- Migration 010: Render-queue claim seam (Mac Mini worker offload)
--
-- Additive and backwards-compatible. Adds a lightweight claim mechanism to
-- video_generation_jobs so a heavy pipeline STEP (montage render, animation/
-- overlay render, FFmpeg composition, additional-ratios) can be ENQUEUED for an
-- outbound-only Mac worker instead of run inline on the web droplet. When no
-- worker is present these columns simply stay NULL and the web server runs the
-- step itself (the historical behaviour), so existing rows and code are
-- unaffected. Safe to run multiple times.

-- ── Per-job claim state ──────────────────────────────────────────────────────
-- render_state:   NULL (nothing queued) | 'queued' | 'claimed' | 'done' | 'failed'
-- render_step:    which heavy step is queued (see src/domain/enums/RenderStep.ts)
-- render_payload: optional JSON args for the step (e.g. { "sceneIndex": 2 })
-- claimed_by:     worker id that claimed the step
-- claimed_at:     when it was claimed (for stale-claim reclaim)
-- render_heartbeat_at: worker keep-alive while a long render runs (reclaim uses this)
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS render_state         TEXT;
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS render_step          TEXT;
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS render_payload       JSONB;
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS claimed_by           TEXT;
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS claimed_at           TIMESTAMPTZ;
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS render_heartbeat_at  TIMESTAMPTZ;

-- Partial index so the worker's "claim next" query only scans actionable rows.
CREATE INDEX IF NOT EXISTS idx_vgj_render_state
  ON video_generation_jobs(render_state)
  WHERE render_state IN ('queued', 'claimed');

-- ── Worker liveness heartbeat ────────────────────────────────────────────────
-- One row per worker; last_seen_at is bumped every few seconds while the worker
-- is running. The web side reads MAX(last_seen_at) to decide whether to enqueue
-- (worker alive) or fall back to running the step inline (no fresh heartbeat).
CREATE TABLE IF NOT EXISTS render_worker_heartbeat (
  worker_id    TEXT        PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

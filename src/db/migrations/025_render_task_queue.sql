-- Migration 025: Dedicated FIFO render-task queue (Mac Mini worker)
--
-- Additive and backwards-compatible. Introduces a first-class queue table where
-- each heavy pipeline STEP is one row, so the worker processes a single flat
-- FIFO line mixed across all requesters (e.g. #1 user B's overlay, #2 user A's
-- merge, #3 user C's compose). This supersedes the single mutable render_* claim
-- columns bolted onto video_generation_jobs in migration 010: those only let a
-- job hold ONE queued step and gave no global ordering, no position count, and
-- no per-step duration history. Those columns are LEFT IN PLACE by this
-- migration (the pipeline/worker cutover happens in a later change) so existing
-- rows and code keep working. Safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── One row per enqueued heavy step ──────────────────────────────────────────
-- state:        'queued' | 'claimed' | 'done' | 'failed'
-- step:         a RenderStep value (see src/domain/enums/RenderStep.ts) — incl.
--               the soft-failing Travy (tvent_generation) step, queued like any
--               other so it takes its place in line.
-- requester_id: clip_requests.user_id, denormalised at enqueue time so the
--               worker log can name which user a step belongs to WITHOUT a join,
--               and so position counts never need to reach into other tables.
-- enqueued_at:  the stable FIFO ordering key (unlike updated_at, never bumped).
-- heartbeat_at: worker keep-alive while a long render runs; reclaim uses this.
-- duration_ms:  wall-clock of the step once finished — feeds the admin monitor.
CREATE TABLE IF NOT EXISTS render_tasks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        TEXT        NOT NULL,
  request_id    TEXT        NOT NULL,
  requester_id  TEXT,
  step          TEXT        NOT NULL,
  payload       JSONB,
  state         TEXT        NOT NULL DEFAULT 'queued',
  attempts      INTEGER     NOT NULL DEFAULT 0,
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by    TEXT,
  claimed_at    TIMESTAMPTZ,
  heartbeat_at  TIMESTAMPTZ,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  duration_ms   BIGINT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The worker's "claim next" scan and every position count only ever touch
-- active rows, ordered by enqueued_at. A partial index keeps that scan tiny even
-- as done/failed rows accumulate as history.
CREATE INDEX IF NOT EXISTS idx_render_tasks_active
  ON render_tasks (enqueued_at)
  WHERE state IN ('queued', 'claimed');

-- A request/job at most has one active step at a time; these support the
-- "where's my step" lookups and admin drill-down.
CREATE INDEX IF NOT EXISTS idx_render_tasks_request ON render_tasks (request_id);
CREATE INDEX IF NOT EXISTS idx_render_tasks_job     ON render_tasks (job_id);

-- Guard against ever double-queuing the same job's step: at most one ACTIVE
-- (queued or claimed) row per job. A re-enqueue must reuse/replace, never stack.
CREATE UNIQUE INDEX IF NOT EXISTS uq_render_tasks_active_job
  ON render_tasks (job_id)
  WHERE state IN ('queued', 'claimed');

-- Migration 028: admin analytics instrumentation.
--
-- Adds the tables the admin analytics surface reads from:
--   1. user_login_events      — there was no login tracking of any kind before
--                               this (NextAuth is JWT-only, no adapter, no
--                               sessions table), so "how many users logged in"
--                               was not computable from stored data.
--   2. pipeline_gate_events   — express-lane auto-approvals write step-history
--                               rows identical to human clicks, so human vs
--                               auto could not be told apart. This table
--                               records the actor and the gate-open → resolve
--                               latency explicitly.
--   3. ai_content_reports     — triage columns. status/resolved_at already
--                               existed but nothing ever wrote them.
--   4. render_worker_samples  — render_worker_heartbeat keeps only one
--                               last_seen_at per worker, so there was no
--                               history of load for CPU sizing.
--
-- ⚠️  NUMBERING: this content was applied to production on 2026-08-16 under the
--     filename "027_admin_analytics.sql". By then 027 was already taken by
--     027_strip_ratio_from_management_titles.sql, so the file is recorded here
--     as 028. The SQL is unchanged — re-running it is a no-op.
--
-- Idempotent. Apply with:
--   node scripts/apply-migration.js src/db/migrations/028_admin_analytics.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Login events ─────────────────────────────────────────────────────────
-- One row per successful sign-in. Never updated. Insertion is fire-and-forget:
-- a failure here must never block a sign-in.
CREATE TABLE IF NOT EXISTS user_login_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,                  -- credentials | google | apple
                                              --   | google-native | apple-native
                                              --   | backfill (synthetic, from users.created_at)
  surface     TEXT,                           -- web | android | ios | pwa | unknown
  is_new_user BOOLEAN NOT NULL DEFAULT FALSE, -- the sign-in that created the account
  ip_hash     TEXT,                           -- sha256(ip + secret); never the raw IP
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events_user     ON user_login_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_created  ON user_login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_provider ON user_login_events (provider, created_at DESC);

-- ── 2. Pipeline gate events ─────────────────────────────────────────────────
-- One row per gate OPENING, closed in place when the gate resolves.
-- job_id / request_id are TEXT with NO foreign key: those id columns are uuid
-- in some environments and text in others (see migrations 006 and 019). This is
-- the same rule render_tasks follows.
CREATE TABLE IF NOT EXISTS pipeline_gate_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       TEXT NOT NULL,
  request_id   TEXT NOT NULL,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  step         TEXT NOT NULL,               -- the awaiting_* VideoGenerationStep
  scene_index  INTEGER,                     -- per-scene gates only
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at  TIMESTAMPTZ,                 -- push actually sent (NULL = suppressed/failed)
  resolved_at  TIMESTAMPTZ,
  resolution   TEXT,                        -- approved | revised | reopened | abandoned
  resolved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_source TEXT,                        -- human | auto | system
  click_count  INTEGER NOT NULL DEFAULT 0,
  wait_seconds INTEGER,                     -- resolved_at - opened_at, stored on close
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one OPEN gate per (job, step, scene). Re-entering a gate after a
-- revision is allowed because the previous row is closed first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_events_open
  ON pipeline_gate_events (job_id, step, COALESCE(scene_index, -1))
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gate_events_step     ON pipeline_gate_events (step, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_events_resolved ON pipeline_gate_events (resolved_at DESC)
  WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gate_events_request  ON pipeline_gate_events (request_id);
CREATE INDEX IF NOT EXISTS idx_gate_events_job      ON pipeline_gate_events (job_id);

-- ── 3. Feedback triage ──────────────────────────────────────────────────────
ALTER TABLE ai_content_reports ADD COLUMN IF NOT EXISTS reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ai_content_reports ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ;
ALTER TABLE ai_content_reports ADD COLUMN IF NOT EXISTS resolution_note   TEXT;
ALTER TABLE ai_content_reports ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_ai_reports_status_created ON ai_content_reports (status, created_at DESC);

-- ── 4. Worker resource samples ──────────────────────────────────────────────
-- Written by scripts/render-worker.ts once a minute (every 6th heartbeat tick).
CREATE TABLE IF NOT EXISTS render_worker_samples (
  id           BIGSERIAL PRIMARY KEY,
  worker_id    TEXT NOT NULL,
  sampled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cpu_percent  REAL,     -- process CPU across all cores since the last sample
  load_avg_1m  REAL,     -- os.loadavg()[0]
  cpu_count    INTEGER,
  mem_used_mb  INTEGER,
  mem_total_mb INTEGER,
  active_tasks INTEGER,  -- tasks this worker holds right now
  queue_depth  INTEGER   -- render_tasks in state queued/claimed, platform-wide
);

CREATE INDEX IF NOT EXISTS idx_worker_samples_time ON render_worker_samples (sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_samples_wid  ON render_worker_samples (worker_id, sampled_at DESC);

COMMIT;

-- Retention: render_worker_samples grows ~1,440 rows/day/worker. Prune from the
-- storage sweep cron:
--   DELETE FROM render_worker_samples WHERE sampled_at < NOW() - INTERVAL '180 days';

-- Migration 035: Phone render attempts (device render lease + idempotent completion)
--
-- WHY. render_tasks can already be claimed by a device (claim_for_device
-- sets claimed_by to the attempt id), but a claim is a lock and nothing more.
-- Three things need a durable receipt per attempt:
--
--   1. IDEMPOTENT COMPLETION. A phone that uploads its export and then loses
--      the network retries. Without a receipt the retry creates a SECOND
--      FinalClip asset pointing at a second Spaces object, and the requester
--      ends up with duplicated exports whose storage nobody reclaims.
--   2. VALIDATED COMPLETION. The server must check the completion against what
--      it actually handed out — this job, step, ratio, stage, manifest version
--      and upload key — instead of trusting the body it is validating.
--   3. LOSING A RACE SAFELY. When a lease expires the Mac worker reclaims the
--      task through the normal claim_next path and finishes it. The phone comes
--      back later with its own output. Because its attempt is no longer the
--      claim owner the completion is refused and the worker wins.
--
-- Additive and idempotent. No existing table is altered. Apply with:
--   node scripts/apply-migration.js src/db/migrations/035_device_render_attempts.sql

CREATE TABLE IF NOT EXISTS device_render_attempts (
  -- The attempt id is ALSO render_tasks.claimed_by for the claim it holds, so
  -- "who owns this task right now" is answerable without a join in either
  -- direction.
  id                  TEXT        PRIMARY KEY,
  task_id             UUID        NOT NULL,
  job_id              TEXT        NOT NULL,
  request_id          TEXT        NOT NULL,
  -- A device may only ever claim work owned by its OWN requester. Denormalised
  -- ownership check on every progress/complete call is a single-row read.
  requester_id        TEXT        NOT NULL,
  step                TEXT        NOT NULL,
  ratio               TEXT        NOT NULL,
  stage               TEXT        NOT NULL,
  travy               BOOLEAN     NOT NULL DEFAULT FALSE,
  manifest_version    INTEGER     NOT NULL,
  platform            TEXT,
  app_version         TEXT,
  -- claimed | uploading | completed | released | failed | expired
  state               TEXT        NOT NULL DEFAULT 'claimed',
  progress_percent    NUMERIC,
  -- The ONLY object key this attempt is authorised to write. Minted server-side
  -- so a device cannot choose where its output lands.
  upload_storage_key  TEXT        NOT NULL,
  upload_id           TEXT,
  result_asset_id     TEXT,
  -- The completion response, replayed verbatim on a repeat completion.
  result              JSONB,
  error               TEXT,
  lease_expires_at    TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Is this task already leased to a phone" and the stale-lease sweep both scan
-- only the live states, which stay a handful of rows however much history
-- accumulates.
CREATE INDEX IF NOT EXISTS idx_device_render_attempts_active
  ON device_render_attempts (task_id, created_at DESC)
  WHERE state IN ('claimed', 'uploading');

CREATE INDEX IF NOT EXISTS idx_device_render_attempts_lease
  ON device_render_attempts (lease_expires_at)
  WHERE state IN ('claimed', 'uploading');

-- Support and admin drill-down: every attempt a request ever made.
CREATE INDEX IF NOT EXISTS idx_device_render_attempts_request
  ON device_render_attempts (request_id, created_at DESC);

-- At most ONE live attempt per task. Two phones (or the same phone twice) must
-- not both believe they hold the lease. The second insert fails loudly instead
-- of producing two uploads for one step.
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_render_attempts_active_task
  ON device_render_attempts (task_id)
  WHERE state IN ('claimed', 'uploading');

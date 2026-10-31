-- =============================================================================
-- Migration 049: LINE intake — link LINE users to RClipper requesters,
-- render-lane columns on clip_requests and render_tasks.
--
-- Additive and idempotent (IF NOT EXISTS / DO blocks).
-- Apply: node scripts/apply-migration.js src/db/migrations/049_line_intake.sql
-- Requires: 048_review_core.sql applied first.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. line_accounts — LINE userId ↔ users.id mapping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS line_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_channel_id  TEXT        NOT NULL,
  line_user_id     TEXT        NOT NULL,
  display_name     TEXT,
  linked_via       TEXT        NOT NULL DEFAULT 'auto_created'
                   CHECK (linked_via IN ('auto_created', 'link_code', 'admin')),
  status           TEXT        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'blocked', 'unlinked')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (line_channel_id, line_user_id)
);
CREATE INDEX IF NOT EXISTS idx_line_accounts_user ON line_accounts(user_id);

-- ---------------------------------------------------------------------------
-- 2. line_link_codes — one-time codes to attach LINE to an existing app account
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS line_link_codes (
  code_hash        TEXT        PRIMARY KEY,
  line_channel_id  TEXT        NOT NULL,
  line_user_id     TEXT        NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  used_by_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  used_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. clip_requests — intake channel and render lane (additive columns)
--    Defaults preserve existing studio/app behaviour.
-- ---------------------------------------------------------------------------
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS intake_channel   TEXT NOT NULL DEFAULT 'studio';
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS package_order_id UUID;
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS external_ref     TEXT;
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS render_lane      TEXT;

DO $$ BEGIN
  ALTER TABLE clip_requests DROP CONSTRAINT IF EXISTS clip_requests_intake_channel_check;
  ALTER TABLE clip_requests ADD CONSTRAINT clip_requests_intake_channel_check
    CHECK (intake_channel IN ('studio', 'web', 'line'));
  ALTER TABLE clip_requests DROP CONSTRAINT IF EXISTS clip_requests_render_lane_check;
  ALTER TABLE clip_requests ADD CONSTRAINT clip_requests_render_lane_check
    CHECK (render_lane IS NULL OR render_lane IN ('mac_mini', 'device', 'operator_pc', 'operator_device'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clip_requests_external_ref
  ON clip_requests(intake_channel, external_ref) WHERE external_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. render_tasks — lane column so Mac Mini and Mar-PC workers claim separately
-- ---------------------------------------------------------------------------
ALTER TABLE render_tasks ADD COLUMN IF NOT EXISTS render_lane TEXT;
CREATE INDEX IF NOT EXISTS idx_render_tasks_lane_queued
  ON render_tasks(render_lane, priority, created_at) WHERE state = 'queued';

-- ---------------------------------------------------------------------------
-- 5. LINE conversation state machine (for the webhook state machine)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS line_conversation_states (
  line_user_id     TEXT        NOT NULL,
  line_channel_id  TEXT        NOT NULL,
  state            TEXT        NOT NULL DEFAULT 'idle',
  context          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (line_channel_id, line_user_id)
);

COMMIT;

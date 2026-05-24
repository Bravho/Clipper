-- Migration 002: Phase 2B clip request tables + pipeline jobs
--
-- Run this against your PostgreSQL database before swapping repositories.
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- Assumes Phase 2A migration (users table) has already been applied.

-- ── clip_requests ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clip_requests (
  id                    TEXT        PRIMARY KEY,
  user_id               TEXT        NOT NULL,
  title                 VARCHAR(100) NOT NULL,
  description           TEXT        NOT NULL,
  target_audience       TEXT        NOT NULL,
  target_platforms      TEXT[]      NOT NULL DEFAULT '{}',
  preferred_style       TEXT        NOT NULL DEFAULT '',
  preferred_language    TEXT        NOT NULL DEFAULT '',
  duration_seconds      INTEGER     NOT NULL DEFAULT 15,
  status                TEXT        NOT NULL DEFAULT 'draft',
  estimated_due_date    TIMESTAMPTZ,
  confirmed_due_date    TIMESTAMPTZ,
  due_date_confirmed    BOOLEAN     NOT NULL DEFAULT false,
  hold_reason           TEXT,
  rejection_reason      TEXT,
  queue_position        INTEGER,
  credit_confirmed      BOOLEAN     NOT NULL DEFAULT false,
  rights_confirmed      BOOLEAN     NOT NULL DEFAULT false,
  credits_cost          INTEGER     NOT NULL DEFAULT 10,
  assigned_editor_id    TEXT,
  editor_type           TEXT,
  price_baht            NUMERIC(10,2) NOT NULL DEFAULT 0,
  credits_used          INTEGER     NOT NULL DEFAULT 0,
  discount_baht         NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_paid_baht      NUMERIC(10,2) NOT NULL DEFAULT 0,
  revision_count        INTEGER     NOT NULL DEFAULT 0,
  submitted_at          TIMESTAMPTZ,
  effort_class          TEXT,
  assigned_staff_id     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table already existed from an earlier schema, add any missing columns:
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS duration_seconds   INTEGER     NOT NULL DEFAULT 15;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS assigned_editor_id TEXT;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS editor_type        TEXT;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS price_baht         NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS credits_used       INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS discount_baht      NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS amount_paid_baht   NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS revision_count     INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS effort_class       TEXT;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS assigned_staff_id  TEXT;

CREATE INDEX IF NOT EXISTS idx_clip_requests_user_id         ON clip_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_clip_requests_status          ON clip_requests(status);
CREATE INDEX IF NOT EXISTS idx_clip_requests_user_status     ON clip_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_clip_requests_status_submitted ON clip_requests(status, submitted_at);

-- ── request_status_history ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS request_status_history (
  id          TEXT        PRIMARY KEY,
  request_id  TEXT        NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  status      TEXT        NOT NULL,
  note        TEXT,
  changed_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_history_request_id ON request_status_history(request_id);

-- ── uploaded_assets ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uploaded_assets (
  id                    TEXT        PRIMARY KEY,
  request_id            TEXT        NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  user_id               TEXT        NOT NULL,
  file_name             TEXT        NOT NULL,
  asset_type            TEXT        NOT NULL,
  file_size_bytes       BIGINT      NOT NULL DEFAULT 0,
  mime_type             TEXT        NOT NULL,
  storage_key           TEXT        NOT NULL DEFAULT '',
  storage_url           TEXT        NOT NULL DEFAULT '',
  thumbnail_key         TEXT        NOT NULL DEFAULT '',
  thumbnail_url         TEXT        NOT NULL DEFAULT '',
  upload_status         TEXT        NOT NULL DEFAULT 'pending',
  video_ratio           TEXT,
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table already existed, add missing columns:
ALTER TABLE uploaded_assets ADD COLUMN IF NOT EXISTS thumbnail_key TEXT NOT NULL DEFAULT '';
ALTER TABLE uploaded_assets ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NOT NULL DEFAULT '';
ALTER TABLE uploaded_assets ADD COLUMN IF NOT EXISTS video_ratio   TEXT;

CREATE INDEX IF NOT EXISTS idx_uploaded_assets_request_id ON uploaded_assets(request_id);

-- ── publishing_links ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS publishing_links (
  id           TEXT        PRIMARY KEY,
  request_id   TEXT        NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  platform     TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publishing_links_request_id ON publishing_links(request_id);

-- ── video_generation_jobs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS video_generation_jobs (
  id                         TEXT        PRIMARY KEY,
  request_id                 TEXT        NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  status                     TEXT        NOT NULL,
  current_step               TEXT        NOT NULL,
  failed_at_step             TEXT,
  scene_plan                 TEXT,
  script_thai                TEXT,
  script_english             TEXT,
  hook_thai                  TEXT,
  hook_english               TEXT,
  caption_thai               TEXT,
  caption_english            TEXT,
  caption_chinese            TEXT,
  approved_scene_plan        TEXT,
  approved_script_thai       TEXT,
  approved_script_english    TEXT,
  approved_hook_thai         TEXT,
  approved_hook_english      TEXT,
  approved_caption_thai      TEXT,
  approved_caption_english   TEXT,
  approved_caption_chinese   TEXT,
  kling_task_id              TEXT,
  base_video_asset_id        TEXT,
  eleven_labs_voice_id       TEXT        NOT NULL,
  voice_recording_asset_id   TEXT,
  processed_voice_asset_id   TEXT,
  final_export_9_16_asset_id TEXT,
  final_export_16_9_asset_id TEXT,
  final_export_1_1_asset_id  TEXT,
  final_export_4_5_asset_id  TEXT,
  content_approved_by        TEXT,
  video_approved_by          TEXT,
  voice_approved_by          TEXT,
  final_approved_by          TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_request_id ON video_generation_jobs(request_id);

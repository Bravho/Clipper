-- Migration 002b: Fix existing tables + create video_generation_jobs
--
-- Run this AFTER the existing Phase 2B tables are in place.
-- Safe to run multiple times.

-- ── clip_requests: add missing columns ──────────────────────────────────────

ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS duration_seconds   INTEGER       NOT NULL DEFAULT 15;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS assigned_editor_id TEXT;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS editor_type        TEXT;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS price_baht         NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS credits_used       INTEGER       NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS discount_baht      NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS amount_paid_baht   NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS revision_count     INTEGER       NOT NULL DEFAULT 0;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS assigned_staff_id  TEXT;

CREATE INDEX IF NOT EXISTS idx_clip_requests_status_submitted ON clip_requests(status, submitted_at);

-- ── uploaded_assets: drop restrictive CHECK, add missing columns ─────────────
-- The original check only allowed 'video'/'image'. Pipeline adds more types.

ALTER TABLE uploaded_assets DROP CONSTRAINT IF EXISTS uploaded_assets_asset_type_check;

ALTER TABLE uploaded_assets ADD COLUMN IF NOT EXISTS thumbnail_key TEXT NOT NULL DEFAULT '';
ALTER TABLE uploaded_assets ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NOT NULL DEFAULT '';
ALTER TABLE uploaded_assets ADD COLUMN IF NOT EXISTS video_ratio   TEXT;

-- ── video_generation_jobs: create with UUID types to match existing schema ───

CREATE TABLE IF NOT EXISTS video_generation_jobs (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                 UUID        NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
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

-- ── request_status_history: create if not exists ────────────────────────────
-- (may already exist as "status_history" — this is the canonical table name)

CREATE TABLE IF NOT EXISTS request_status_history (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID        NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  status     TEXT        NOT NULL,
  note       TEXT,
  changed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_status_history_request_id ON request_status_history(request_id);

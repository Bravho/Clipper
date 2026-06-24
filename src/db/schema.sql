-- =============================================================================
-- Clipper Platform — Initial Schema
-- Run this once against your PostgreSQL database before starting the app.
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL UNIQUE,
  full_name  TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'requester'
                         CHECK (role IN ('requester', 'editor', 'admin')),
  email_verified BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- auth_identities
-- One user may have multiple providers (e.g. email + Google linked later).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_identities (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT        NOT NULL CHECK (provider IN ('credentials', 'google')),
  provider_account_id TEXT,           -- Google sub / OAuth account ID; NULL for credentials
  password_hash       TEXT,           -- bcrypt hash; NULL for OAuth providers
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_account_id)  -- prevents duplicate OAuth accounts
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id);

-- -----------------------------------------------------------------------------
-- credit_wallets  (one per user, enforced by UNIQUE constraint)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_wallets (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance                 INTEGER     NOT NULL DEFAULT 0,
  initial_credits_granted BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- credit_transactions  (immutable ledger — never UPDATE or DELETE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_transactions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       INTEGER     NOT NULL,   -- positive = credit, negative = debit
  type         TEXT        NOT NULL
               CHECK (type IN ('signup_bonus', 'request_charge', 'admin_credit', 'admin_debit')),
  description  TEXT        NOT NULL,
  reference_id UUID,                   -- soft reference to clip_requests.id — intentionally NOT a FK constraint
                                       -- (reference_id is audit metadata; enforcing FK would require clip_requests
                                       --  to be fully migrated to Postgres before credit transactions can be recorded)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);

-- -----------------------------------------------------------------------------
-- terms_acceptances  (immutable audit log — never UPDATE or DELETE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_type    TEXT        NOT NULL
                 CHECK (policy_type IN ('terms_of_service', 'ownership_rights', 'privacy_policy', 'storage_retention')),
  policy_version TEXT        NOT NULL,
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address     TEXT,
  user_agent     TEXT
);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_user_id ON terms_acceptances(user_id);

-- -----------------------------------------------------------------------------
-- email_verification_tokens
-- One-time tokens for verifying email addresses on signup.
-- Immutable once created; mark used via used_at timestamp.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,   -- SHA-256 hex of the raw URL token
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,                   -- NULL = not yet used
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);

-- -----------------------------------------------------------------------------
-- video_generation_jobs
-- Durable AI pipeline state for each clip request. The requester/staff UI reads
-- this record after browser reloads and server restarts to resume the current
-- generation/approval step.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS video_generation_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step TEXT NOT NULL,
  failed_at_step TEXT,

  scene_plan TEXT,
  script_thai TEXT,
  script_english TEXT,
  script_chinese TEXT,
  hook_thai TEXT,
  hook_english TEXT,
  caption_thai TEXT,
  caption_english TEXT,
  caption_chinese TEXT,

  approved_scene_plan TEXT,
  approved_script_thai TEXT,
  approved_script_english TEXT,
  approved_script_chinese TEXT,
  approved_hook_thai TEXT,
  approved_hook_english TEXT,
  approved_caption_thai TEXT,
  approved_caption_english TEXT,
  approved_caption_chinese TEXT,

  video_gen_task_id TEXT,
  video_gen_task_ids TEXT,
  scene_video_asset_ids TEXT,
  video_gen_status TEXT,
  video_gen_last_polled_at TIMESTAMPTZ,
  base_video_asset_id TEXT,

  tts_task_id TEXT,
  eleven_labs_voice_id TEXT NOT NULL DEFAULT '',
  voice_recording_asset_id TEXT,
  processed_voice_asset_id TEXT,
  selected_music_track TEXT,
  voice_duration_seconds NUMERIC,
  voice_timestamps TEXT,

  subtitle_languages TEXT[] NOT NULL DEFAULT ARRAY['en','zh'],
  subtitle_timeline TEXT,
  animation_spec TEXT,
  animated_video_asset_id TEXT,
  animated_overlay_asset_ids TEXT,

  final_export_9_16_asset_id TEXT,
  final_export_16_9_asset_id TEXT,
  final_export_1_1_asset_id TEXT,
  final_export_4_5_asset_id TEXT,
  final_export_tvent_asset_id TEXT,

  content_approved_by TEXT,
  video_approved_by TEXT,
  voice_approved_by TEXT,
  animation_approved_by TEXT,
  final_approved_by TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_request_id
  ON video_generation_jobs(request_id);

CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_current_step
  ON video_generation_jobs(current_step);

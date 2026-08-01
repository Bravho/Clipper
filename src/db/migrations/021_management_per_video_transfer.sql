-- 021_management_per_video_transfer.sql
--
-- Move RClipper Management transfers from one-item-per-PROJECT to
-- one-item-per-VIDEO. Each generated export (a ratio/channel video) becomes its
-- own management_content_items row, so a user can transfer, manage and publish
-- each video independently, and a "transfer all" simply transfers each one.
--
-- The discriminator is `source_asset_id` — the uploaded_assets id of the specific
-- generated export. Stored as TEXT with NO FK (uploaded_assets.id may be uuid or
-- text depending on when the DB was migrated — see 019/006 — and this column
-- only needs to identify and de-duplicate, not enforce referential integrity).
--
-- IDEMPOTENT. Safe to re-run: guards on IF (NOT) EXISTS throughout.

BEGIN;

-- ── 1. The per-video discriminator ────────────────────────────────────────────
ALTER TABLE management_content_items
  ADD COLUMN IF NOT EXISTS source_asset_id TEXT;

-- ── 2. Replace the uniqueness rule ────────────────────────────────────────────
-- Old rule: one live item per (user, generation) — blocked per-video transfers.
-- New rule: one live item per (user, generation, source_asset_id). Uploads keep
-- source_generation_id NULL and are excluded, exactly as before.
DROP INDEX IF EXISTS uq_mgmt_content_per_source;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mgmt_content_per_source_video
  ON management_content_items(user_id, source_generation_id, source_asset_id)
  WHERE source_generation_id IS NOT NULL
    AND source_asset_id IS NOT NULL
    AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_mgmt_content_source_asset
  ON management_content_items(source_generation_id, source_asset_id)
  WHERE source_asset_id IS NOT NULL;

COMMIT;

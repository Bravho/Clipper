-- 022_management_content_editable.sql
--
-- Make a RClipper Management video individually editable and soft-deletable.
--
--   default_caption / default_hashtags
--       A per-video default caption and hashtag set, edited on the video card
--       and pre-filled into every channel when publishing. For a TRANSFERRED
--       video these are seeded from the generation's final post kit at transfer
--       time; for a user UPLOAD they start blank for the user to fill in.
--
--   removed_at
--       Soft delete. A removed video disappears from the library and its
--       publishing history is preserved, but nothing is destroyed immediately —
--       the stored file is left for its Space lifecycle rule to purge on the
--       normal schedule. `removed_at IS NOT NULL` is the "Removed" state; it is
--       deliberately separate from `status` so the status vocabulary (and its
--       CHECK) is untouched.
--
-- ADDITIVE and IDEMPOTENT. Safe to re-run.

BEGIN;

ALTER TABLE management_content_items
  ADD COLUMN IF NOT EXISTS default_caption  TEXT,
  ADD COLUMN IF NOT EXISTS default_hashtags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS removed_at       TIMESTAMPTZ;

-- The library lists a user's live (not-removed) videos newest-first; this covers
-- that hot path and keeps removed rows out of it.
CREATE INDEX IF NOT EXISTS idx_mgmt_content_user_live
  ON management_content_items(user_id, created_at DESC)
  WHERE removed_at IS NULL;

COMMIT;

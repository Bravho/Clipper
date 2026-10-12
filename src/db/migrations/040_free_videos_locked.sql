-- 040_free_videos_locked.sql
--
-- FREE VIDEOS STAY IN THE APP; A PACKAGE TAKES THEM OUT (Tho, 2026-10-12).
--
--   * A free account may submit 2 requests in its whole life
--     (config/videoPackages.ts FREE_REQUESTS_TOTAL — counted from
--     clip_requests.pricing_tier, nothing new is stored for it).
--   * A free request's videos can be watched in the app but not downloaded or
--     sent to Channel Management: `download_unlocked` stays false until the
--     account buys a package (VideoAccessService.unlockForPackage).
--   * Every finished video is kept at most 30 days: `videos_expire_at` below,
--     stamped at the first delivery and moved to purchase + 30 days when a
--     package unlocks a free request. The user sees this date on every video.
--
-- Requests that already exist keep `download_unlocked = true` (migration 033
-- unlocked them all) — nobody loses a video they could download yesterday.
--
-- clip_requests is defined in the root migrations/ folder, so every statement
-- is guarded and this file is a no-op on a database without that table.
--
-- Idempotent; re-running converges.
--   node scripts/apply-migration.js src/db/migrations/040_free_videos_locked.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('clip_requests') IS NULL THEN
    RAISE NOTICE '040: clip_requests not found — skipped';
    RETURN;
  END IF;

  ALTER TABLE clip_requests
    ADD COLUMN IF NOT EXISTS videos_expire_at TIMESTAMPTZ;

  -- Videos already delivered get the same 30-day window, counted from when
  -- they were last touched (the closest thing to their delivery date stored).
  UPDATE clip_requests
     SET videos_expire_at = updated_at + INTERVAL '30 days'
   WHERE videos_expire_at IS NULL
     AND status IN ('delivered', 'published');

  -- The retention sweep and the purchase unlock both look requests up by expiry.
  CREATE INDEX IF NOT EXISTS idx_clip_requests_videos_expire_at
    ON clip_requests (videos_expire_at)
    WHERE videos_expire_at IS NOT NULL;

  -- The purchase unlock reads "this user's locked free requests".
  CREATE INDEX IF NOT EXISTS idx_clip_requests_user_locked
    ON clip_requests (user_id)
    WHERE download_unlocked = false;
END $$;

COMMIT;

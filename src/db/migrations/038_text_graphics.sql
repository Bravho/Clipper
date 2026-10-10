-- 038_text_graphics.sql
--
-- Scene-matched TEXT GRAPHICS (Oct 2026): a hook title, per-scene labels with
-- badges and a closing call-to-action card, written per request by Claude and
-- drawn by the phone in the chosen style pack (src/config/textGraphicStyles.ts).
--
--   video_generation_jobs.selected_text_style
--     What the requester picked in the studio's Graphic step: auto | premium |
--     street | cafe | none. Existing rows default to 'none', so every job made
--     before this change renders exactly as before.
--
--   video_generation_jobs.text_graphics_plan
--     The written plan as JSON (src/lib/textGraphics/plan.ts → TextGraphicsPlan),
--     including the fingerprint of the inputs it was written from. Null until
--     the studio previews it or production starts.
--
-- Idempotent; re-running converges.
--   node scripts/apply-migration.js src/db/migrations/038_text_graphics.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.video_generation_jobs') IS NOT NULL THEN
    ALTER TABLE video_generation_jobs
      ADD COLUMN IF NOT EXISTS selected_text_style TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE video_generation_jobs
      ADD COLUMN IF NOT EXISTS text_graphics_plan TEXT;
  END IF;
END $$;

COMMIT;

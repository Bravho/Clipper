-- 045_campaign_story_formats.sql
--
-- Story formats for Merchant Campaign quick videos (19 Oct 2026): a shop's
-- template lists up to 4 formats (src/config/campaignStoryFormats.ts — My
-- Little Moment, Guess Where I Am, …) and the customer picks one. Empty = the
-- original single-clip video, so existing templates behave exactly as before.
--
-- Additive and idempotent. Requires 043. Apply with:
--   node scripts/apply-migration.js src/db/migrations/045_campaign_story_formats.sql

BEGIN;

ALTER TABLE campaign_templates
  ADD COLUMN IF NOT EXISTS story_formats TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_templates_story_formats_max4'
  ) THEN
    ALTER TABLE campaign_templates
      ADD CONSTRAINT campaign_templates_story_formats_max4
      CHECK (cardinality(story_formats) <= 4);
  END IF;
END $$;

COMMIT;

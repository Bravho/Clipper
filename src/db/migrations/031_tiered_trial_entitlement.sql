-- Migration 031: Tiered trial entitlement (1 free clean clip + 3 watermarked previews)
--
-- Replaces the two-state trial model (first request free-but-locked, everything
-- else paid up front) with a three-rung ladder, decided from how many requests
-- the account has already submitted:
--
--   #1        free_clean   — free, NO watermark, download_unlocked = true
--   #2 – #4   free_preview — free, watermarked, download_unlocked = false until
--                            the unlock price is paid
--   #5 …      paid_upfront — charged at submission, download_unlocked = true
--
-- Two schema changes:
--   1. clip_requests.pricing_tier            — which rung a request was submitted on
--   2. prior_trial_requests_used             — how much allowance a PREVIOUS life of
--      (users + deleted_account_registry)      an identity consumed, so a deleted-and-
--                                              recreated account resumes where it left
--                                              off instead of getting the ladder again.
--
-- The legacy boolean columns (users.trial_consumed,
-- deleted_account_registry.trial_consumed, clip_requests.is_trial_request) are
-- left in place: is_trial_request is still written (it means "not charged at
-- submission"), and the two trial_consumed columns become dead once this
-- migration has copied them forward. They can be dropped in a later migration
-- after a release has confirmed nothing reads them.
--
-- Idempotent. Apply with:
--   node scripts/apply-migration.js src/db/migrations/031_tiered_trial_entitlement.sql

-- ── 1. clip_requests.pricing_tier ──────────────────────────────────────────
-- Default 'paid_upfront' is the safe value: it never hands out a free clip.
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS pricing_tier TEXT NOT NULL DEFAULT 'paid_upfront';

-- Backfill from the old model. An old-model trial request was exactly the
-- free_preview shape (free to generate, watermarked, pay to download), so it maps
-- straight across. Guarded on the default so re-running never rewrites rows that
-- the application has since written a real tier onto.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'clip_requests' AND column_name = 'is_trial_request'
  ) THEN
    UPDATE clip_requests
       SET pricing_tier = 'free_preview'
     WHERE is_trial_request = true
       AND pricing_tier = 'paid_upfront';
  END IF;
END $$;

ALTER TABLE clip_requests
  DROP CONSTRAINT IF EXISTS clip_requests_pricing_tier_check;
ALTER TABLE clip_requests
  ADD CONSTRAINT clip_requests_pricing_tier_check
  CHECK (pricing_tier IN ('free_clean', 'free_preview', 'paid_upfront'));

CREATE INDEX IF NOT EXISTS idx_clip_requests_pricing_tier
  ON clip_requests (pricing_tier);

-- Counting the ladder means counting submitted requests per user, on every
-- dashboard load and every submit.
CREATE INDEX IF NOT EXISTS idx_clip_requests_user_submitted
  ON clip_requests (user_id) WHERE submitted_at IS NOT NULL;

-- ── 2. users.prior_trial_requests_used ─────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS prior_trial_requests_used INT NOT NULL DEFAULT 0;

-- A legacy trial_consumed = true account had its whole free trial revoked (it
-- was a carry-over from a deleted account). Carrying 4 forward preserves that:
-- the account stays on paid_upfront. Live accounts are deliberately NOT
-- backfilled from their own request count — their submitted requests are counted
-- live, so an existing user with 3 submissions correctly lands on their last
-- preview slot.
-- Guarded: `trial_consumed` is a legacy column created outside this migrations/
-- directory, so it may not exist on every environment. Referencing it directly
-- would abort the whole migration on an environment that never had it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'trial_consumed'
  ) THEN
    UPDATE users
       SET prior_trial_requests_used = 4
     WHERE trial_consumed = true
       AND prior_trial_requests_used = 0;
  END IF;
END $$;

-- ── 3. deleted_account_registry.prior_trial_requests_used ──────────────────
-- Guarded on the table as well: deleted_account_registry is created outside this
-- migrations/ directory. Same reasoning for the backfill value as for users — a
-- registry row that recorded "trial consumed" recorded a fully-spent allowance
-- under the old one-clip model, and the strictest reading of that under the new
-- ladder is that all 4 rungs are gone.
DO $$
BEGIN
  IF to_regclass('public.deleted_account_registry') IS NULL THEN
    RAISE NOTICE 'deleted_account_registry not present — skipping';
    RETURN;
  END IF;

  ALTER TABLE deleted_account_registry
    ADD COLUMN IF NOT EXISTS prior_trial_requests_used INT NOT NULL DEFAULT 0;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'deleted_account_registry'
       AND column_name = 'trial_consumed'
  ) THEN
    UPDATE deleted_account_registry
       SET prior_trial_requests_used = 4
     WHERE trial_consumed = true
       AND prior_trial_requests_used = 0;
  END IF;
END $$;

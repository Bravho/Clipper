-- 034_pricing_bundles.sql
--
-- The 2026-09-09 pricing ladder.
--
--   Video packages        1mo 200  · 3mo  570 · 6mo 1140 · 12mo 2160   (033, re-seeded there)
--   Publishing only       1mo 180  · 3mo  500 · 6mo 1000 · 12mo 2000
--   Bundle (both)         1mo 350  · 3mo 1000 · 6mo 1900 · 12mo 3500
--
-- Two things are new here beyond the numbers:
--
--   1. A ONE-MONTH publishing pass. Management previously started at 3 months
--      while video started at 1, so the two ladders could not be compared and a
--      1-month bundle had nothing to be a bundle OF.
--
--   2. BUNDLES. A bundle is a Management product that also grants video months.
--      It is modelled that way — rather than as a video package that also grants
--      publishing — because `management_access_passes.purchase_id` is a NOT NULL
--      FK to `management_purchases`, so a pass cannot exist without a Management
--      purchase row, whereas `video_allowance_windows.purchase_id` is plain TEXT
--      and accepts that same id. One purchase, one debit, one transaction, both
--      entitlements. See ManagementPurchaseService.
--
-- Idempotent: every statement is IF NOT EXISTS / ON CONFLICT DO UPDATE, so
-- re-running this file converges rather than erroring.

BEGIN;

-- ── 1. Bundles carry a video allowance ──────────────────────────────────────
ALTER TABLE management_products
  ADD COLUMN IF NOT EXISTS video_months INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'management_products_video_months_positive'
  ) THEN
    ALTER TABLE management_products
      ADD CONSTRAINT management_products_video_months_positive
      CHECK (video_months IS NULL OR video_months > 0);
  END IF;
END $$;

COMMENT ON COLUMN management_products.video_months IS
  'Bundles only: months of video-generation allowance granted alongside the publishing pass. NULL for publishing-only products.';

-- ── 2. A one-month pass needs a one-month entitlement type ──────────────────
-- `entitlement_type` is snapshotted onto a publication to record what authorised
-- it. The 1-month pass (and the 1-month bundle, which grants the same length of
-- publishing rights) needs its own value.
ALTER TABLE management_publications
  DROP CONSTRAINT IF EXISTS management_publications_entitlement_type_check;

ALTER TABLE management_publications
  ADD CONSTRAINT management_publications_entitlement_type_check
  CHECK (entitlement_type IN ('single_video','one_month','three_months',
                              'six_months','one_year','none'));

-- ── 3. The catalogue ────────────────────────────────────────────────────────
-- price_credits is what is actually charged; full_price_credits is the list
-- price shown struck through. They are EQUAL for everything except the entry
-- bundle, which stays a genuine 50 %-off trial: these are real prices, not a
-- discount off an invented higher number.
INSERT INTO management_products
  (code, name, description, product_type, duration_months, video_months,
   price_credits, full_price_credits, sort_order)
VALUES
  ('management_single_video',
   'Starter Credit Pack',
   'Four uploads, usable within 30 days. One upload publishes one video to one channel.',
   'single_video', NULL, NULL, 50, 100, 1),

  ('management_access_1_month',
   '1-Month Publishing Access',
   'Prepaid unlimited publishing for 1 month. No automatic renewal.',
   'access_pass', 1, NULL, 180, 180, 2),
  ('management_access_3_months',
   '3-Month Publishing Access',
   'Prepaid unlimited publishing for 3 months. No automatic renewal.',
   'access_pass', 3, NULL, 500, 500, 3),
  ('management_access_6_months',
   '6-Month Publishing Access',
   'Prepaid unlimited publishing for 6 months. No automatic renewal.',
   'access_pass', 6, NULL, 1000, 1000, 4),
  ('management_access_1_year',
   '1-Year Publishing Access',
   'Prepaid unlimited publishing for 1 year. No automatic renewal.',
   'access_pass', 12, NULL, 2000, 2000, 5),

  ('management_bundle_1_month',
   'Complete — 1 Month',
   '10 videos a month at priority, plus unlimited publishing, for 1 month.',
   'access_pass', 1, 1, 350, 350, 6),
  ('management_bundle_3_months',
   'Complete — 3 Months',
   '10 videos a month at priority, plus unlimited publishing, for 3 months.',
   'access_pass', 3, 3, 1000, 1000, 7),
  ('management_bundle_6_months',
   'Complete — 6 Months',
   '10 videos a month at priority, plus unlimited publishing, for 6 months.',
   'access_pass', 6, 6, 1900, 1900, 8),
  ('management_bundle_1_year',
   'Complete — 1 Year',
   '10 videos a month at priority, plus unlimited publishing, for 1 year.',
   'access_pass', 12, 12, 3500, 3500, 9)
ON CONFLICT (code) DO UPDATE SET
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  product_type       = EXCLUDED.product_type,
  duration_months    = EXCLUDED.duration_months,
  video_months       = EXCLUDED.video_months,
  price_credits      = EXCLUDED.price_credits,
  full_price_credits = EXCLUDED.full_price_credits,
  sort_order         = EXCLUDED.sort_order,
  is_active          = TRUE,
  updated_at         = NOW();

COMMIT;

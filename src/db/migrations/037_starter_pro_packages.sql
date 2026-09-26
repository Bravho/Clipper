-- 037_starter_pro_packages.sql
--
-- The 2026-09-27 price structure: ONE kind of product, a package that includes
-- video making AND unlimited publishing (Channel Management) for its term, in
-- two tiers.
--
--   Starter   5 videos/month   1mo 190 · 3mo  540 · 6mo 1030 · 12mo 1890   (new codes)
--   Pro      10 videos/month   1mo 350 · 3mo  990 · 6mo 1890 · 12mo 3490   (management_bundle_*)
--
-- Retired (no longer sold, honoured until they expire):
--   * video_products            video_1_month … video_12_months
--   * management_products       management_single_video, management_access_*
--
-- Mirrors src/config/management.ts (MANAGEMENT_PRODUCTS). Prices must move in
-- both places together.
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT DO UPDATE); re-running converges.
--   node scripts/apply-migration.js src/db/migrations/037_starter_pro_packages.sql

BEGIN;

-- ── 1. A package month's worth, per product ─────────────────────────────────
-- Until now every video month was worth REQUESTS_PER_PAID_MONTH (10). Starter
-- months are worth 5, so the product carries its own number, and the purchase
-- writes it into each window's total_allowance.
ALTER TABLE management_products
  ADD COLUMN IF NOT EXISTS video_requests_per_month INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'management_products_video_requests_positive'
  ) THEN
    ALTER TABLE management_products
      ADD CONSTRAINT management_products_video_requests_positive
      CHECK (video_requests_per_month IS NULL OR video_requests_per_month > 0);
  END IF;
END $$;

COMMENT ON COLUMN management_products.video_requests_per_month IS
  'Packages only: video requests each granted month is worth (Starter 5, Pro 10). NULL for publishing-only products.';

-- ── 2. The catalogue ────────────────────────────────────────────────────────
INSERT INTO management_products
  (code, name, description, product_type, duration_months, video_months,
   video_requests_per_month, price_credits, full_price_credits, sort_order)
VALUES
  ('management_starter_1_month',
   'Starter — 1 Month',
   '5 videos a month plus unlimited publishing, for 1 month. Prepaid, no automatic renewal.',
   'access_pass', 1, 1, 5, 190, 190, 6),
  ('management_starter_3_months',
   'Starter — 3 Months',
   '5 videos a month plus unlimited publishing, for 3 months. Prepaid, no automatic renewal.',
   'access_pass', 3, 3, 5, 540, 540, 7),
  ('management_starter_6_months',
   'Starter — 6 Months',
   '5 videos a month plus unlimited publishing, for 6 months. Prepaid, no automatic renewal.',
   'access_pass', 6, 6, 5, 1030, 1030, 8),
  ('management_starter_1_year',
   'Starter — 1 Year',
   '5 videos a month plus unlimited publishing, for 1 year. Prepaid, no automatic renewal.',
   'access_pass', 12, 12, 5, 1890, 1890, 9),

  ('management_bundle_1_month',
   'Pro — 1 Month',
   '10 videos a month plus unlimited publishing, for 1 month. Prepaid, no automatic renewal.',
   'access_pass', 1, 1, 10, 350, 350, 10),
  ('management_bundle_3_months',
   'Pro — 3 Months',
   '10 videos a month plus unlimited publishing, for 3 months. Prepaid, no automatic renewal.',
   'access_pass', 3, 3, 10, 990, 990, 11),
  ('management_bundle_6_months',
   'Pro — 6 Months',
   '10 videos a month plus unlimited publishing, for 6 months. Prepaid, no automatic renewal.',
   'access_pass', 6, 6, 10, 1890, 1890, 12),
  ('management_bundle_1_year',
   'Pro — 1 Year',
   '10 videos a month plus unlimited publishing, for 1 year. Prepaid, no automatic renewal.',
   'access_pass', 12, 12, 10, 3490, 3490, 13)
ON CONFLICT (code) DO UPDATE SET
  name                     = EXCLUDED.name,
  description              = EXCLUDED.description,
  product_type             = EXCLUDED.product_type,
  duration_months          = EXCLUDED.duration_months,
  video_months             = EXCLUDED.video_months,
  video_requests_per_month = EXCLUDED.video_requests_per_month,
  price_credits            = EXCLUDED.price_credits,
  full_price_credits       = EXCLUDED.full_price_credits,
  sort_order               = EXCLUDED.sort_order,
  is_active                = TRUE,
  updated_at               = NOW();

-- ── 3. Retire the split products ────────────────────────────────────────────
-- is_active = FALSE takes them out of listActive() (every picker) and out of
-- findByCode() (so checkout refuses them). Purchases, passes, upload tokens and
-- allowance windows already granted are untouched and stay valid until expiry.
UPDATE management_products
   SET is_active = FALSE, updated_at = NOW()
 WHERE code IN ('management_single_video',
                'management_access_1_month',
                'management_access_3_months',
                'management_access_6_months',
                'management_access_1_year');

UPDATE video_products
   SET active = FALSE, updated_at = NOW()
 WHERE code IN ('video_1_month', 'video_3_months', 'video_6_months', 'video_12_months');

COMMIT;

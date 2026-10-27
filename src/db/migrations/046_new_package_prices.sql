-- 046_new_package_prices.sql
--
-- NEW PACKAGE PRICING (2026-10-27). Mirrors src/config/management.ts
-- (MANAGEMENT_PRODUCTS). Prices must move in both places together.
--
--   Starter   5 videos/month   1mo 190 -> 99    12mo 1890 -> 990
--   Pro      10 videos/month   1mo 350 -> 179   12mo 3490 -> 1790
--   3-month and 6-month packages (both tiers): taken off sale.
--
-- WHY THIS MIGRATION MATTERS: checkout (ManagementPurchaseService.resolveProduct)
-- charges management_products.price_credits from the DATABASE, and the app's
-- package picker lists rows from listActive(). Until this is applied, checkout
-- keeps charging the old prices even though the config says otherwise.
--
-- EXISTING BUYERS ARE NOT AFFECTED. This touches ONLY the 8 catalogue rows in
-- management_products. Purchases (which store the amount actually charged),
-- passes, upload tokens and video allowance windows already granted are not
-- read or written, so every existing buyer keeps exactly what they bought.
-- Off sale uses the same mechanism as migration 037: is_active = FALSE takes a
-- product out of listActive() (every picker) and findByCode() (checkout refuses
-- it); what was already granted stays valid until it expires.
--
-- No DELETE, no DROP, no schema change. Idempotent: re-running converges.
-- WRITTEN ONLY - Tho applies migrations.

BEGIN;

-- 1. New prices for the packages still on sale.
UPDATE management_products
   SET price_credits = 99, full_price_credits = 99, updated_at = NOW()
 WHERE code = 'management_starter_1_month';

UPDATE management_products
   SET price_credits = 990, full_price_credits = 990, updated_at = NOW()
 WHERE code = 'management_starter_1_year';

UPDATE management_products
   SET price_credits = 179, full_price_credits = 179, updated_at = NOW()
 WHERE code = 'management_bundle_1_month';

UPDATE management_products
   SET price_credits = 1790, full_price_credits = 1790, updated_at = NOW()
 WHERE code = 'management_bundle_1_year';

-- 2. 3-month and 6-month packages off sale for NEW purchases (rows kept,
--    prices unchanged, existing holders unaffected).
UPDATE management_products
   SET is_active = FALSE, updated_at = NOW()
 WHERE code IN ('management_starter_3_months',
                'management_starter_6_months',
                'management_bundle_3_months',
                'management_bundle_6_months');

COMMIT;

-- Migration 042: record what an App Store / Google Play purchase actually cost
--
-- WHY. mobile_store_purchases kept the product id and the credits granted, but
-- not the price the person paid, so the admin Revenue page could only guess App
-- Store and Google Play income from the catalogue's planning figures. From now
-- on each verified purchase stores its price:
--
--   price_source = 'store'  read from the store's own signed transaction
--                           (Apple's App Store Server API returns price and
--                           currency in the signed transaction).
--   price_source = 'app'    the store price the app showed at purchase time
--                           (Play Billing's product price, sent with the
--                           verification). Google's purchase API does not
--                           return a price.
--   NULL                    rows from before this migration — the Revenue page
--                           estimates them from the catalogue and says so.
--
-- storefront / order_id are kept for reconciliation against App Store Connect
-- and Play Console reports.
--
-- Additive and idempotent. Apply with:
--   node scripts/apply-migration.js src/db/migrations/042_store_purchase_price.sql

ALTER TABLE mobile_store_purchases ADD COLUMN IF NOT EXISTS price_amount   NUMERIC(12, 2);
ALTER TABLE mobile_store_purchases ADD COLUMN IF NOT EXISTS price_currency TEXT;
ALTER TABLE mobile_store_purchases ADD COLUMN IF NOT EXISTS price_source   TEXT;
ALTER TABLE mobile_store_purchases ADD COLUMN IF NOT EXISTS storefront     TEXT;
ALTER TABLE mobile_store_purchases ADD COLUMN IF NOT EXISTS order_id       TEXT;

ALTER TABLE mobile_store_purchases
  DROP CONSTRAINT IF EXISTS mobile_store_purchases_price_source_check;
ALTER TABLE mobile_store_purchases
  ADD CONSTRAINT mobile_store_purchases_price_source_check
  CHECK (price_source IS NULL OR price_source IN ('store', 'app'));

-- The Revenue page reads purchases by date.
CREATE INDEX IF NOT EXISTS idx_mobile_store_purchases_created
  ON mobile_store_purchases (created_at DESC);

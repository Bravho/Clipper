-- 040_ad_lab_ads_outcomes.sql
-- Ad Lab: TikTok Ads Manager link fields + Chinese_TTT outcome snapshots.
-- Additive and idempotent. Does NOT enable ad buying or payments inside RClipper.
-- Apply manually when ready:
--   node scripts/apply-migration.js src/db/migrations/040_ad_lab_ads_outcomes.sql

BEGIN;

-- Link organic publication targets to Marketing API campaign structure.
ALTER TABLE ad_lab_publication_targets
  ADD COLUMN IF NOT EXISTS ads_advertiser_id TEXT,
  ADD COLUMN IF NOT EXISTS ads_campaign_id   TEXT,
  ADD COLUMN IF NOT EXISTS ads_adgroup_id    TEXT,
  ADD COLUMN IF NOT EXISTS ads_ad_id         TEXT,
  ADD COLUMN IF NOT EXISTS ads_spark_code    TEXT,
  ADD COLUMN IF NOT EXISTS ads_status        TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ads_targeting     JSONB,
  ADD COLUMN IF NOT EXISTS ads_stub          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ads_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ads_last_error    TEXT,
  ADD COLUMN IF NOT EXISTS ads_metrics       JSONB;

CREATE INDEX IF NOT EXISTS idx_ad_lab_targets_ads_ad
  ON ad_lab_publication_targets(ads_ad_id)
  WHERE ads_ad_id IS NOT NULL;

-- LINE Official Account friend-count time series (Chinese_TTT growth).
CREATE TABLE IF NOT EXISTS ad_lab_line_friend_snapshots (
  id           BIGSERIAL   PRIMARY KEY,
  owner_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id     TEXT        NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  friend_count INTEGER     NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'line_oa',
  raw          JSONB
);

CREATE INDEX IF NOT EXISTS idx_ad_lab_line_friends_brand
  ON ad_lab_line_friend_snapshots(owner_id, brand_id, captured_at DESC);

-- Stripe succeeded charges aggregated for a brand/period (read-only).
CREATE TABLE IF NOT EXISTS ad_lab_stripe_revenue_snapshots (
  id              BIGSERIAL   PRIMARY KEY,
  owner_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id        TEXT        NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_baht     NUMERIC(14,2) NOT NULL DEFAULT 0,
  charge_count    INTEGER       NOT NULL DEFAULT 0,
  currency        TEXT          NOT NULL DEFAULT 'thb',
  product_filter  TEXT,
  raw             JSONB
);

CREATE INDEX IF NOT EXISTS idx_ad_lab_stripe_brand
  ON ad_lab_stripe_revenue_snapshots(owner_id, brand_id, period_end DESC);

-- Manual / CSV Ads Manager row imports (fallback when API tokens missing).
CREATE TABLE IF NOT EXISTS ad_lab_ads_imports (
  id             BIGSERIAL   PRIMARY KEY,
  owner_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id       TEXT        NOT NULL,
  target_id      UUID        REFERENCES ad_lab_publication_targets(id) ON DELETE SET NULL,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  campaign_name  TEXT,
  ad_id          TEXT,
  spend          NUMERIC(14,2) NOT NULL DEFAULT 0,
  impressions    INTEGER,
  clicks         INTEGER,
  conversions    INTEGER,
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  raw_row        JSONB
);

CREATE INDEX IF NOT EXISTS idx_ad_lab_ads_imports_brand
  ON ad_lab_ads_imports(owner_id, brand_id, imported_at DESC);

COMMIT;

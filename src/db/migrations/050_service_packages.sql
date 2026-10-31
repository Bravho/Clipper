-- =============================================================================
-- Migration 050: Service packages — package definitions, orders, usage ledger,
-- and Stripe payment intent tracking for LINE-intake orders.
--
-- Additive and idempotent (IF NOT EXISTS / DO blocks).
-- Apply: node scripts/apply-migration.js src/db/migrations/050_service_packages.sql
-- Requires: 048_review_core.sql, 049_line_intake.sql applied first.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. service_packages — package catalogue (managed by admin)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_packages (
  code                 TEXT        PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  name_th              TEXT        NOT NULL,
  price_baht           NUMERIC(10,2) NOT NULL CHECK (price_baht >= 0),
  clips_included       SMALLINT    NOT NULL CHECK (clips_included > 0),
  revisions_per_clip   SMALLINT    NOT NULL DEFAULT 2 CHECK (revisions_per_clip >= 0),
  max_duration_seconds SMALLINT    NOT NULL DEFAULT 90,
  ratios_included      TEXT[]      NOT NULL DEFAULT ARRAY['9:16'],
  includes             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  valid_days           SMALLINT    NOT NULL DEFAULT 30,
  stripe_price_id      TEXT,       -- Stripe Price ID (TEST mode)
  stripe_payment_link  TEXT,       -- pre-created Stripe Payment Link URL
  active               BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with the four packages from owner decision 4 (placeholders)
INSERT INTO service_packages
  (code, name_th, price_baht, clips_included, revisions_per_clip, max_duration_seconds, valid_days)
VALUES
  ('trial',   'Trial — 2 คลิป',    299.00,  2,  2, 90, 30),
  ('starter', 'Starter — 8 คลิป',  1490.00, 8,  2, 90, 30),
  ('growth',  'Growth — 12 คลิป',  2690.00, 12, 2, 90, 30),
  ('pro',     'Pro — 16 คลิป',     4290.00, 16, 2, 90, 30)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. package_orders — one row per purchase
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS package_orders (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_code       TEXT        NOT NULL REFERENCES service_packages(code),
  clips_included     SMALLINT    NOT NULL,
  revisions_per_clip SMALLINT    NOT NULL,
  price_baht         NUMERIC(10,2) NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'pending_payment'
                     CHECK (status IN ('pending_payment', 'active', 'used_up', 'expired', 'cancelled')),
  paid_reference     TEXT,
  stripe_session_id  TEXT,       -- Stripe Checkout Session ID (for webhook matching)
  starts_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_package_orders_user_status
  ON package_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_package_orders_stripe
  ON package_orders(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. package_usage — append-only ledger (never UPDATE/DELETE)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS package_usage (
  id                BIGSERIAL   PRIMARY KEY,
  package_order_id  UUID        NOT NULL REFERENCES package_orders(id) ON DELETE CASCADE,
  request_id        TEXT        NOT NULL,
  kind              TEXT        NOT NULL CHECK (kind IN (
                      'clip', 'revision', 'extra', 'refund_clip', 'refund_revision')),
  units             SMALLINT    NOT NULL DEFAULT 1,
  review_item_id    UUID,
  extra_price_baht  NUMERIC(10,2),
  note              TEXT,
  created_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_package_usage_order
  ON package_usage(package_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_usage_clip_per_request
  ON package_usage(request_id) WHERE kind = 'clip';

-- ---------------------------------------------------------------------------
-- 4. stripe_webhook_events — dedup table for Stripe events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  stripe_event_id  TEXT        PRIMARY KEY,
  event_type       TEXT        NOT NULL,
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;

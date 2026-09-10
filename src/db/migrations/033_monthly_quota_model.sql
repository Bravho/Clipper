-- Migration 033: Monthly quota model (3 free/month, 10/month paid)
--
-- WHY. The per-request ฿50 charge and the watermarked preview tier are withdrawn.
-- The scarce resource is render capacity, not money: one clip is 2–3 hours on a
-- single worker. So access is now a monthly QUOTA, and money buys a bigger quota
-- and a better place in the queue rather than individual clips.
--
--   Free  — 3 requests per rolling 30 days, LOW render priority, no watermark.
--   Paid  — a prepaid package grants 10 requests per month, HIGH priority.
--
-- Paid packages are prepaid, credit-bought and non-renewing, exactly like the
-- Management products: no subscription object, no renewal timer, no new payment
-- provider, and store policy already satisfied because money enters only through
-- the platform's own billing.
--
-- Idempotent. Apply with:
--   node scripts/apply-migration.js src/db/migrations/033_monthly_quota_model.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. The trusted package catalogue ────────────────────────────────────────
-- Mirrors src/config/videoPackages.ts, the same way migration 019 mirrors the
-- Management catalogue. Prices are server-side truth: the client only ever sends
-- a product code.
CREATE TABLE IF NOT EXISTS video_products (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT        NOT NULL UNIQUE,
  months         INTEGER     NOT NULL CHECK (months > 0),
  -- 'days' → each window is window_days long; 'calendar_month' → each window
  -- advances by one calendar month, so a year lands on a real anniversary.
  window_kind    TEXT        NOT NULL CHECK (window_kind IN ('days', 'calendar_month')),
  window_days    INTEGER,
  price_credits  INTEGER     NOT NULL CHECK (price_credits >= 0),
  requests_per_month INTEGER NOT NULL CHECK (requests_per_month > 0),
  active         BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO video_products
  (code, months, window_kind, window_days, price_credits, requests_per_month, sort_order)
VALUES
  ('video_1_month',   1,  'days',           30,   200, 10, 1),
  ('video_3_months',  3,  'days',           30,   570, 10, 2),
  ('video_6_months',  6,  'days',           30,  1140, 10, 3),
  ('video_12_months', 12, 'calendar_month', NULL, 2160, 10, 4)
ON CONFLICT (code) DO UPDATE SET
  months             = EXCLUDED.months,
  window_kind        = EXCLUDED.window_kind,
  window_days        = EXCLUDED.window_days,
  price_credits      = EXCLUDED.price_credits,
  requests_per_month = EXCLUDED.requests_per_month,
  sort_order         = EXCLUDED.sort_order,
  updated_at         = NOW();

-- ── 2. Purchased monthly allowance windows ──────────────────────────────────
-- ONE ROW PER MONTH BOUGHT. A 6-month package inserts six rows running
-- back-to-back, which is what makes allowances NON-AGGREGATING: month 2 starts
-- when month 1 expires, so month 1's unspent requests die with it. No carry-over
-- logic exists anywhere — the expiry does the work.
CREATE TABLE IF NOT EXISTS video_allowance_windows (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT        NOT NULL,
  product_code          TEXT        NOT NULL,
  -- Idempotency key for the purchase. UNIQUE with sequence, so a double-clicked
  -- checkout returns the existing months instead of granting a second run.
  purchase_id           TEXT        NOT NULL,
  sequence              INTEGER     NOT NULL CHECK (sequence >= 0),
  credit_transaction_id TEXT,
  total_allowance       INTEGER     NOT NULL CHECK (total_allowance > 0),
  -- CHECKed at storage level so no application bug can oversell a month.
  remaining             INTEGER     NOT NULL CHECK (remaining >= 0),
  starts_at             TIMESTAMPTZ NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'expired', 'revoked', 'refunded')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT video_allowance_remaining_within_total
    CHECK (remaining <= total_allowance),
  CONSTRAINT video_allowance_window_ordered
    CHECK (expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_video_allowance_purchase_sequence
  ON video_allowance_windows (purchase_id, sequence);

-- The spend path: "this user's live window with requests left, oldest expiring
-- first". Every quota check and every submission runs it.
CREATE INDEX IF NOT EXISTS idx_video_allowance_spendable
  ON video_allowance_windows (user_id, expires_at)
  WHERE status = 'active' AND remaining > 0;

CREATE INDEX IF NOT EXISTS idx_video_allowance_user ON video_allowance_windows (user_id);

-- ── 3. Which window paid for a request ──────────────────────────────────────
-- Needed to return the request when a 2–3 hour render fails: without it there is
-- no way to know which month to credit back. NULL for free-tier requests.
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS video_allowance_window_id UUID;

-- Refunds are keyed on the request, so a retry cannot refund the same request
-- twice.
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS allowance_refunded_at TIMESTAMPTZ;

-- ── 4. Retire the paywall ───────────────────────────────────────────────────
-- The ฿50 unlock no longer exists, so a request left download-locked could never
-- be unlocked by anyone. Unlock them all rather than strand users mid-flow.
UPDATE clip_requests
   SET download_unlocked = true
 WHERE download_unlocked = false;

-- Collapse the three-value tier to the two allowances. `paid_upfront` was money
-- received; both free rungs become the free allowance.
ALTER TABLE clip_requests DROP CONSTRAINT IF EXISTS clip_requests_pricing_tier_check;

UPDATE clip_requests SET pricing_tier = 'paid' WHERE pricing_tier = 'paid_upfront';
UPDATE clip_requests SET pricing_tier = 'free'
 WHERE pricing_tier IN ('free_clean', 'free_preview');

ALTER TABLE clip_requests
  ALTER COLUMN pricing_tier SET DEFAULT 'free';

ALTER TABLE clip_requests
  ADD CONSTRAINT clip_requests_pricing_tier_check
  CHECK (pricing_tier IN ('free', 'paid'));

-- The free allowance counts submissions in a rolling 30-day window, per user.
CREATE INDEX IF NOT EXISTS idx_clip_requests_user_submitted_at
  ON clip_requests (user_id, submitted_at)
  WHERE submitted_at IS NOT NULL;

-- Credit balances are deliberately untouched: credits remain the currency for
-- video packages and Channel Management packages alike.

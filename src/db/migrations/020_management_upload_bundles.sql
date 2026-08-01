-- 020_management_upload_bundles.sql
--
-- Repricing RClipper Management's entry product from a PERMANENT single-video
-- unlock into a CONSUMABLE, EXPIRING bundle of upload tokens.
--
--   management_single_video : 50 credits → 4 uploads, usable within 30 days.
--
-- One token is spent per video published to ONE channel (one publication
-- target). The same file to three channels spends three tokens. Unused tokens
-- expire when the window lapses. Access passes are unchanged — they grant
-- unlimited publishing for their period and never touch a bundle.
--
-- This migration is ADDITIVE and IDEMPOTENT. It does not drop the legacy
-- management_publish_entitlements table (kept for history); the entry product
-- simply stops granting a permanent unlock and grants a bundle instead.
--
-- Type note: it mirrors 019 exactly — user_id/product/purchase are UUID with
-- FKs, credit_transaction_id is a bare UUID with NO FK (the credit ledger's id
-- type is not assumed here, matching how 019 stored it).

BEGIN;

-- ── 1. Product columns: how big the bundle is and how long to spend it ────────
ALTER TABLE management_products
  ADD COLUMN IF NOT EXISTS upload_allowance   INTEGER,
  ADD COLUMN IF NOT EXISTS access_window_days INTEGER;

-- Re-sync the entry product. Access passes keep NULL (unlimited, no window).
UPDATE management_products
   SET upload_allowance = 4, access_window_days = 30, updated_at = NOW()
 WHERE code = 'management_single_video';

UPDATE management_products
   SET upload_allowance = NULL, access_window_days = NULL, updated_at = NOW()
 WHERE product_type = 'access_pass';

-- ── 2. The purchased bundle ───────────────────────────────────────────────────
-- One row per purchase. `remaining` is decremented as tokens are spent; the
-- CHECKs make an over-spend or a negative balance impossible at the storage
-- layer, so a racing double-publish cannot drive it below zero.
CREATE TABLE IF NOT EXISTS management_upload_bundles (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  management_product_id UUID        NOT NULL REFERENCES management_products(id),
  product_code          TEXT        NOT NULL,
  -- UNIQUE(purchase_id): a replayed activation returns the existing bundle
  -- instead of granting a second allowance for one payment.
  purchase_id           UUID        NOT NULL UNIQUE
                        REFERENCES management_purchases(id) ON DELETE CASCADE,
  credit_transaction_id UUID,
  total_allowance       INTEGER     NOT NULL CHECK (total_allowance > 0),
  remaining             INTEGER     NOT NULL CHECK (remaining >= 0),
  starts_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','expired','refunded','revoked')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT management_upload_bundle_remaining_le_total
    CHECK (remaining <= total_allowance)
);

-- The hot query: a user's spendable bundles (active, in-window, with tokens
-- left), oldest-expiring first so tokens are consumed FIFO.
CREATE INDEX IF NOT EXISTS idx_mgmt_bundle_spendable
  ON management_upload_bundles(user_id, expires_at)
  WHERE status = 'active' AND remaining > 0;

-- ── 3. Link each spent token to the bundle that paid for it ───────────────────
-- Nullable: a target published under an access pass consumes no token and
-- leaves this NULL. ON DELETE SET NULL so pruning a bundle never deletes the
-- publishing history that spent it.
ALTER TABLE management_publication_targets
  ADD COLUMN IF NOT EXISTS upload_bundle_id UUID
    REFERENCES management_upload_bundles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mgmt_target_bundle
  ON management_publication_targets(upload_bundle_id)
  WHERE upload_bundle_id IS NOT NULL;

COMMIT;

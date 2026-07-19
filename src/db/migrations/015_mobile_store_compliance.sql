-- Mobile store compliance: push device registry and idempotent delivery log.

CREATE TABLE IF NOT EXISTS push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  token TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user_enabled
  ON push_devices(user_id, enabled);

CREATE TABLE IF NOT EXISTS push_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_user
  ON push_notification_deliveries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mobile_store_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  product_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  credits_granted INTEGER NOT NULL CHECK (credits_granted > 0),
  store_environment TEXT NOT NULL,
  purchased_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_store_purchases_user
  ON mobile_store_purchases(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (
    reason IN ('unsafe', 'sexual', 'violent', 'hate', 'privacy',
               'impersonation', 'copyright', 'misleading', 'other')
  ),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_content_reports_status
  ON ai_content_reports(status, created_at);

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check CHECK (
    type IN (
      'signup_bonus', 'request_charge', 'request_refund',
      'admin_credit', 'admin_debit', 'discount_applied', 'top_up'
    )
  );

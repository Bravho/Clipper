-- Additive, idempotent. Apply separately; never applied by the handoff routes.
BEGIN;
CREATE TABLE IF NOT EXISTS line_handoff_notification_limits (
  shop_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (shop_user_id, window_start)
);
COMMIT;

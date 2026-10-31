-- Additive runtime support; never applied by the application.
BEGIN;
CREATE TABLE IF NOT EXISTS render_lane_heartbeats (
  lane TEXT PRIMARY KEY CHECK (lane IN ('main', 'backup')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE line_webhook_events ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE line_webhook_events ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE line_webhook_events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS shop_review_preferences JSONB NOT NULL DEFAULT '{}';
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS shop_rules JSONB NOT NULL DEFAULT '{}';
COMMIT;

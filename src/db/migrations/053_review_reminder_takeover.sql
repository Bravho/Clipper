-- Additive columns; never applied by the application.
BEGIN;

-- Track when a Grok Bot reminder was last sent for a review item so we don't spam.
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Per-shop human-takeover flag: when set the LINE webhook ignores incoming messages
-- and lets a human operator handle the conversation.
ALTER TABLE line_accounts ADD COLUMN IF NOT EXISTS takeover_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE line_accounts ADD COLUMN IF NOT EXISTS takeover_expires_at TIMESTAMPTZ;

COMMIT;

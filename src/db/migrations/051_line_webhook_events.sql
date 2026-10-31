-- =============================================================================
-- Migration 051: LINE webhook event deduplication table.
--
-- Additive and idempotent (IF NOT EXISTS).
-- Apply: node scripts/apply-migration.js src/db/migrations/051_line_webhook_events.sql
-- Requires: 049_line_intake.sql applied first.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS line_webhook_events (
  event_id    TEXT        PRIMARY KEY,
  event_type  TEXT        NOT NULL,
  channel_id  TEXT        NOT NULL DEFAULT '',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_webhook_events_channel
  ON line_webhook_events(channel_id, processed_at DESC);

COMMIT;

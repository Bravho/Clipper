-- 060_line_conversation_event_is_test.sql
--
-- PROPOSED — NOT APPLIED. Tho applies migrations manually:
--   node scripts/apply-migration.js src/db/migrations/060_line_conversation_event_is_test.sql
-- (Numbered 060 because an unrelated, unapplied 059_line_handoff.sql already
-- exists in the working tree. 060 does not depend on 059.)
--
-- Adds is_test to the two LINE tables that lack it, so Phase 2 rows on the live
-- database can be told apart from production rows:
--   * line_conversation_states  (one row per channel + LINE user)
--   * line_webhook_events       (dedupe / lease rows per webhook event)
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS with a constant default
-- (metadata-only on PG 11+, no table rewrite), CREATE INDEX IF NOT EXISTS, and
-- backfills that only flip FALSE -> TRUE for rows that provably belong to an
-- is_test LINE account. No row is deleted and no existing column changes.
--
-- No application code reads or writes these columns yet. Wiring (tag new rows
-- from the owning line_accounts.is_test, filter by LINE_TEST_MODE) is a separate
-- change that must ship only AFTER this migration is applied, otherwise the
-- running server would query a missing column.
--
-- Requires 049, 051, 052 and 054 (line_accounts.is_test).

BEGIN;

ALTER TABLE line_conversation_states ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE line_webhook_events      ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill conversations: same channel + LINE user as an is_test account.
UPDATE line_conversation_states cs
   SET is_test = TRUE
  FROM line_accounts la
 WHERE la.is_test = TRUE
   AND la.line_channel_id = cs.line_channel_id
   AND la.line_user_id   = cs.line_user_id
   AND cs.is_test = FALSE;

-- Backfill webhook events: the stored event's source.userId (052 payload) on the
-- same channel as an is_test account. Rows without a payload stay FALSE.
UPDATE line_webhook_events ev
   SET is_test = TRUE
  FROM line_accounts la
 WHERE la.is_test = TRUE
   AND la.line_channel_id = ev.channel_id
   AND ev.payload IS NOT NULL
   AND jsonb_typeof(ev.payload) = 'object'
   AND la.line_user_id = ev.payload->'source'->>'userId'
   AND ev.is_test = FALSE;

-- Small partial indexes: test rows are few, and test-only lookups/cleanup
-- should not scan production rows.
CREATE INDEX IF NOT EXISTS idx_line_conversation_states_is_test
  ON line_conversation_states (line_channel_id, line_user_id) WHERE is_test = TRUE;
CREATE INDEX IF NOT EXISTS idx_line_webhook_events_is_test
  ON line_webhook_events (channel_id, processed_at DESC) WHERE is_test = TRUE;

COMMIT;

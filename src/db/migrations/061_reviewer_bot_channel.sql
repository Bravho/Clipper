-- 061: add the RevBot reviewer name to the review tables.
-- The old 'grokbot_app' value stays allowed so existing rows remain valid.
BEGIN;

ALTER TABLE review_items DROP CONSTRAINT review_items_decided_via_check;
ALTER TABLE review_items ADD CONSTRAINT review_items_decided_via_check
  CHECK (decided_via IS NULL OR decided_via IN ('grokbot_app', 'revbot_app', 'web', 'auto', 'system'));

ALTER TABLE review_actions DROP CONSTRAINT review_actions_actor_via_check;
ALTER TABLE review_actions ADD CONSTRAINT review_actions_actor_via_check
  CHECK (actor_via IN ('grokbot_app', 'revbot_app', 'web', 'auto', 'system', 'grokbot'));

ALTER TABLE review_outbox DROP CONSTRAINT review_outbox_channel_check;
ALTER TABLE review_outbox ADD CONSTRAINT review_outbox_channel_check
  CHECK (channel IN ('grokbot_app', 'revbot_app', 'web_push', 'line_notify', 'telegram', 'email'));
ALTER TABLE review_outbox ALTER COLUMN channel SET DEFAULT 'revbot_app';

COMMIT;

-- 023_management_channel_suggestions.sql
--
-- Carry a generated video's selected distribution channels and final per-channel
-- post copy into Channel Management. These rows are recommendations only: an
-- actual publication target is still created solely after the user explicitly
-- chooses one of their connected social accounts.
--
-- ADDITIVE and IDEMPOTENT. Existing transferred content receives no automatic
-- recommendation; retrying its transfer will populate the snapshot.

BEGIN;

CREATE TABLE IF NOT EXISTS management_content_channel_suggestions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  management_content_id UUID        NOT NULL
                        REFERENCES management_content_items(id) ON DELETE CASCADE,
  platform              TEXT        NOT NULL,
  display_order         INTEGER     NOT NULL DEFAULT 0
                        CHECK (display_order >= 0),
  title                 TEXT,
  caption               TEXT,
  hashtags              TEXT[]      NOT NULL DEFAULT '{}',
  locale                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mgmt_content_channel_suggestion
    UNIQUE (management_content_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_mgmt_channel_suggestion_content
  ON management_content_channel_suggestions(management_content_id, display_order);

COMMIT;

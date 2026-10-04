-- 039_ad_lab_publications.sql
-- Ad Lab (private channel-marketing tool): real publishing and its results.
--
-- One publication = one video sent to one or more connected social accounts
-- through the publishing provider (Post for Me). Each destination is a target
-- row that carries its own outcome, the latest platform metrics, and the money
-- side (spend / revenue / conversions) the owner enters, so cost-effectiveness
-- can be compared per post and per channel.
--
-- owner_id references users(id): publishing needs a real RClipper account
-- (the dev-only local login cannot publish). Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS ad_lab_publications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id          TEXT        NOT NULL,
  draft_id          TEXT        NOT NULL,
  plan_id           TEXT,
  campaign_name     TEXT        NOT NULL,
  caption           TEXT        NOT NULL DEFAULT '',
  video_key         TEXT        NOT NULL,
  video_name        TEXT        NOT NULL DEFAULT '',
  provider          TEXT        NOT NULL DEFAULT 'post_for_me',
  provider_post_id  TEXT,
  -- sending | processing | published | partially_failed | failed
  status            TEXT        NOT NULL DEFAULT 'sending',
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_lab_publications_owner
  ON ad_lab_publications(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_lab_publication_targets (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id       UUID        NOT NULL REFERENCES ad_lab_publications(id) ON DELETE CASCADE,
  channel              TEXT        NOT NULL,          -- tiktok | instagram | facebook | youtube
  connection_id        TEXT        NOT NULL,          -- social_connections.id
  provider_account_id  TEXT        NOT NULL,
  platform             TEXT        NOT NULL,          -- provider platform, e.g. tiktok_business
  account_label        TEXT        NOT NULL DEFAULT '',
  -- pending | published | failed
  status               TEXT        NOT NULL DEFAULT 'pending',
  platform_post_id     TEXT,
  platform_url         TEXT,
  error                TEXT,
  published_at         TIMESTAMPTZ,
  -- Money side, entered by the owner (THB).
  planned_budget       NUMERIC(14,2) NOT NULL DEFAULT 0,
  spend                NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue              NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversions          INTEGER       NOT NULL DEFAULT 0,
  -- Latest normalized metrics + the provider's raw payload for later re-analysis.
  metrics              JSONB,
  metrics_raw          JSONB,
  metrics_fetched_at   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (publication_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_lab_targets_publication
  ON ad_lab_publication_targets(publication_id);

-- Every metrics fetch is kept, so a post's growth over time can be charted.
CREATE TABLE IF NOT EXISTS ad_lab_metric_snapshots (
  id           BIGSERIAL   PRIMARY KEY,
  target_id    UUID        NOT NULL REFERENCES ad_lab_publication_targets(id) ON DELETE CASCADE,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metrics      JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_lab_snapshots_target
  ON ad_lab_metric_snapshots(target_id, captured_at DESC);

COMMIT;

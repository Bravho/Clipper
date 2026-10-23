-- 043_merchant_campaigns.sql
--
-- Merchant Referral Campaigns (Oct 2026). A shop's QR opens the RClipper app
-- with no login; the customer shoots one clip, the PHONE renders a branded
-- video (nothing is uploaded), they post it themselves and get a small gift.
-- Friends redeem the creator's referral code later in iTravy, which reads it
-- through /api/travy/referral-codes/:code.
--
-- The server only stores small data: shops, templates, campaigns, anonymous
-- creators (a peppered hash of a random install id — never a device
-- identifier), referral codes, reward claims and optional post links.
--
-- Additive and idempotent; no existing table is touched. Apply with:
--   node scripts/apply-migration.js src/db/migrations/043_merchant_campaigns.sql
-- (Numbered 043 because 041 studio_events and 042 store_purchase_price are taken.)

BEGIN;

CREATE TABLE IF NOT EXISTS merchants (
  id           TEXT        PRIMARY KEY,
  name         TEXT        NOT NULL,
  category     TEXT        NOT NULL DEFAULT '',
  location     TEXT        NOT NULL DEFAULT '',
  address      TEXT        NOT NULL DEFAULT '',
  phone        TEXT        NOT NULL DEFAULT '',
  notes        TEXT        NOT NULL DEFAULT '',
  -- active | archived
  status       TEXT        NOT NULL DEFAULT 'active',
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_templates (
  id                      TEXT        PRIMARY KEY,
  merchant_id             TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name                    TEXT        NOT NULL,
  motion_template_id      TEXT        NOT NULL DEFAULT 'none',
  text_style_id           TEXT        NOT NULL DEFAULT 'premium',
  accent_color            TEXT        NOT NULL DEFAULT '#D7262E',
  intro_kicker            TEXT        NOT NULL DEFAULT '',
  intro_title             TEXT        NOT NULL DEFAULT '',
  intro_sub               TEXT        NOT NULL DEFAULT '',
  cta_title               TEXT        NOT NULL DEFAULT '',
  cta_place               TEXT        NOT NULL DEFAULT '',
  default_statement       TEXT        NOT NULL DEFAULT '',
  -- a public/musics catalogue id, or 'clip_sound' (keep the recorded sound)
  default_music_track_id  TEXT        NOT NULL DEFAULT 'clip_sound',
  caption_language        TEXT        NOT NULL DEFAULT 'th',
  created_by              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaign_templates_merchant_idx ON campaign_templates (merchant_id);

CREATE TABLE IF NOT EXISTS merchant_campaigns (
  id                     TEXT          PRIMARY KEY,
  merchant_id            TEXT          NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  template_id            TEXT          NOT NULL REFERENCES campaign_templates(id),
  -- public id in the QR link (/c/<slug>) and the secret printed with it (?k=)
  slug                   TEXT          NOT NULL UNIQUE,
  qr_key                 TEXT          NOT NULL,
  title                  TEXT          NOT NULL,
  discount_percent       NUMERIC(5,2)  NOT NULL DEFAULT 5,
  reward_description     TEXT          NOT NULL DEFAULT '',
  reward_cooldown_days   INTEGER       NOT NULL DEFAULT 30,
  -- draft | live | paused | ended
  status                 TEXT          NOT NULL DEFAULT 'draft',
  starts_at              TIMESTAMPTZ,
  ends_at                TIMESTAMPTZ,
  published_at           TIMESTAMPTZ,
  created_by             TEXT,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_campaigns_merchant_idx ON merchant_campaigns (merchant_id);

-- One anonymous phone installation.
CREATE TABLE IF NOT EXISTS campaign_creators (
  id             TEXT        PRIMARY KEY,
  install_hash   TEXT        NOT NULL UNIQUE,
  platform       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A creator in one campaign. The referral code is unique across ALL campaigns
-- (iTravy looks a code up on its own) and can never change once issued.
CREATE TABLE IF NOT EXISTS creator_campaigns (
  id              TEXT        PRIMARY KEY,
  creator_id      TEXT        NOT NULL REFERENCES campaign_creators(id) ON DELETE CASCADE,
  campaign_id     TEXT        NOT NULL REFERENCES merchant_campaigns(id) ON DELETE CASCADE,
  merchant_id     TEXT        NOT NULL,
  referral_code   TEXT        NOT NULL UNIQUE,
  videos_made     INTEGER     NOT NULL DEFAULT 0,
  last_video_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (creator_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS creator_campaigns_campaign_idx ON creator_campaigns (campaign_id);

CREATE OR REPLACE FUNCTION creator_campaigns_code_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'referral_code is immutable once issued (%).', OLD.referral_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS creator_campaigns_code_immutable ON creator_campaigns;
CREATE TRIGGER creator_campaigns_code_immutable
  BEFORE UPDATE ON creator_campaigns
  FOR EACH ROW EXECUTE FUNCTION creator_campaigns_code_immutable();

-- Every creator-reward attempt, granted or refused by the per-device limit.
CREATE TABLE IF NOT EXISTS creator_reward_claims (
  id                    TEXT        PRIMARY KEY,
  creator_campaign_id   TEXT        NOT NULL REFERENCES creator_campaigns(id) ON DELETE CASCADE,
  creator_id            TEXT        NOT NULL,
  campaign_id           TEXT        NOT NULL,
  merchant_id           TEXT        NOT NULL,
  install_hash          TEXT        NOT NULL,
  referral_code         TEXT        NOT NULL,
  -- granted | rejected_limit
  status                TEXT        NOT NULL,
  claimed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS creator_reward_claims_device_idx
  ON creator_reward_claims (install_hash, campaign_id, claimed_at DESC);
CREATE INDEX IF NOT EXISTS creator_reward_claims_campaign_idx
  ON creator_reward_claims (campaign_id, claimed_at DESC);

-- Optional: the link of the post the creator published.
CREATE TABLE IF NOT EXISTS creator_social_posts (
  id                    TEXT        PRIMARY KEY,
  creator_campaign_id   TEXT        NOT NULL REFERENCES creator_campaigns(id) ON DELETE CASCADE,
  creator_id            TEXT        NOT NULL,
  campaign_id           TEXT        NOT NULL,
  merchant_id           TEXT        NOT NULL,
  -- facebook | instagram | tiktok | other
  social_platform       TEXT        NOT NULL,
  post_url              TEXT        NOT NULL,
  referral_code         TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (creator_campaign_id, post_url)
);
CREATE INDEX IF NOT EXISTS creator_social_posts_campaign_idx ON creator_social_posts (campaign_id);

COMMIT;

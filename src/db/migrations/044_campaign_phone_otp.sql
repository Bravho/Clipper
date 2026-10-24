-- 044_campaign_phone_otp.sql
--
-- Creator phone OTP for Merchant Referral Campaigns + the link to iTravy
-- (18 Oct 2026).
--
-- Before the phone makes a quick video, the creator verifies a phone number
-- by SMS code. RClipper then registers the creator's referral code WITH that
-- phone at iTravy (POST https://api.travy.buzz/api/referral/rclipper/codes,
-- field creator_phone). iTravy keeps only its own HMAC of it in
-- referral_creators.phone_hash and refuses a redemption whose OTP-verified
-- phone is the creator's (reason SELF_REFERRAL).
--
-- RClipper itself stores only a peppered hash of the E.164 number and its
-- last four digits. OTP codes are stored hashed; 5 minutes, 5 tries.
--
-- Additive and idempotent. Requires 043. Apply with:
--   node scripts/apply-migration.js src/db/migrations/044_campaign_phone_otp.sql

BEGIN;

-- The creator's verified phone (one per installation).
ALTER TABLE campaign_creators ADD COLUMN IF NOT EXISTS phone_hash TEXT;
ALTER TABLE campaign_creators ADD COLUMN IF NOT EXISTS phone_last4 TEXT;
ALTER TABLE campaign_creators ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
-- When iTravy last accepted this creator's phone (iTravy keeps it per creator).
ALTER TABLE campaign_creators ADD COLUMN IF NOT EXISTS itravy_phone_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS campaign_creators_phone_idx ON campaign_creators (phone_hash);

-- Per campaign: require a verified creator phone before the video (default yes),
-- and the iTravy campaign the codes are redeemed in (uuid from iTravy admin).
ALTER TABLE merchant_campaigns ADD COLUMN IF NOT EXISTS require_phone_otp BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE merchant_campaigns ADD COLUMN IF NOT EXISTS itravy_campaign_id TEXT;

-- Has iTravy accepted this creator's code?
ALTER TABLE creator_campaigns ADD COLUMN IF NOT EXISTS itravy_registered_at TIMESTAMPTZ;
ALTER TABLE creator_campaigns ADD COLUMN IF NOT EXISTS itravy_error TEXT;

-- The creator-reward limit also counts per phone (two installs, one number).
ALTER TABLE creator_reward_claims ADD COLUMN IF NOT EXISTS phone_hash TEXT;
CREATE INDEX IF NOT EXISTS creator_reward_claims_phone_idx
  ON creator_reward_claims (phone_hash, campaign_id, claimed_at DESC);

CREATE TABLE IF NOT EXISTS campaign_phone_otps (
  id             TEXT        PRIMARY KEY,
  install_hash   TEXT        NOT NULL,
  phone_hash     TEXT        NOT NULL,
  phone_last4    TEXT        NOT NULL,
  -- HMAC(pepper, id:code); the code itself is never stored
  code_hash      TEXT        NOT NULL,
  attempts       INTEGER     NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ NOT NULL,
  verified_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaign_phone_otps_install_idx ON campaign_phone_otps (install_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_phone_otps_phone_idx ON campaign_phone_otps (phone_hash, created_at DESC);

COMMIT;

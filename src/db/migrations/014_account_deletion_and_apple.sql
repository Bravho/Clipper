-- Migration 014: Account deletion (App Store / Play Store compliant) + Apple Sign-In
--
-- 1. users.deleted_at        — tombstone marker. Deletion anonymizes PII in place
--                              (full_name, email) so financial/consent records that
--                              reference users.id survive without personal data.
-- 2. users.trial_consumed    — set TRUE at creation when the deleted-account
--                              registry shows this email/OAuth identity already
--                              used the free trial. Checked by isFirstRequest().
-- 3. deleted_account_registry — minimal fraud-prevention record kept after account
--                              deletion. Stores only SHA-256 hashes of the email
--                              and OAuth provider account id (one-way, not linked
--                              to the deleted user row) plus the entitlement flags
--                              needed to prevent free-trial reuse. Retention basis:
--                              fraud prevention (Google Play User Data policy
--                              exception; disclosed in privacy policy).
-- 4. auth_identities provider CHECK — allow 'apple' for Sign in with Apple
--                              (App Store guideline 4.8).
--
-- Idempotent. Apply with:
--   node scripts/apply-migration.js src/db/migrations/014_account_deletion_and_apple.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_consumed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE auth_identities
  DROP CONSTRAINT IF EXISTS auth_identities_provider_check;
ALTER TABLE auth_identities
  ADD CONSTRAINT auth_identities_provider_check
  CHECK (provider IN ('credentials', 'google', 'apple'));

CREATE TABLE IF NOT EXISTS deleted_account_registry (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash            TEXT        NOT NULL,  -- sha256(lower(trim(email))), hex
  provider              TEXT        NOT NULL
                        CHECK (provider IN ('credentials', 'google', 'apple')),
  provider_account_hash TEXT,                  -- sha256(provider account id), hex; NULL for credentials
  trial_consumed        BOOLEAN     NOT NULL DEFAULT FALSE,
  bonus_granted         BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deleted_account_registry_email_hash
  ON deleted_account_registry(email_hash);

CREATE INDEX IF NOT EXISTS idx_deleted_account_registry_provider_account_hash
  ON deleted_account_registry(provider_account_hash);

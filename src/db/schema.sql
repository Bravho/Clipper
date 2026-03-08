-- =============================================================================
-- Clipper Platform — Initial Schema
-- Run this once against your PostgreSQL database before starting the app.
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL UNIQUE,
  full_name  TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'requester'
                         CHECK (role IN ('requester', 'staff', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- auth_identities
-- One user may have multiple providers (e.g. email + Google linked later).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_identities (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT        NOT NULL CHECK (provider IN ('credentials', 'google')),
  provider_account_id TEXT,           -- Google sub / OAuth account ID; NULL for credentials
  password_hash       TEXT,           -- bcrypt hash; NULL for OAuth providers
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_account_id)  -- prevents duplicate OAuth accounts
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id);

-- -----------------------------------------------------------------------------
-- credit_wallets  (one per user, enforced by UNIQUE constraint)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_wallets (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance                 INTEGER     NOT NULL DEFAULT 0,
  initial_credits_granted BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- credit_transactions  (immutable ledger — never UPDATE or DELETE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_transactions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       INTEGER     NOT NULL,   -- positive = credit, negative = debit
  type         TEXT        NOT NULL
               CHECK (type IN ('signup_bonus', 'request_charge', 'admin_credit', 'admin_debit')),
  description  TEXT        NOT NULL,
  reference_id UUID,                   -- FK → clip_requests.id (future table)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);

-- -----------------------------------------------------------------------------
-- terms_acceptances  (immutable audit log — never UPDATE or DELETE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_type    TEXT        NOT NULL
                 CHECK (policy_type IN ('terms_of_service', 'ownership_rights', 'privacy_policy', 'storage_retention')),
  policy_version TEXT        NOT NULL,
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address     TEXT,
  user_agent     TEXT
);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_user_id ON terms_acceptances(user_id);

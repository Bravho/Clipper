-- Migration 029: "ลืมรหัสผ่าน" (forgot password) self-service reset.
--
-- Mirrors email_verification_tokens (migration 002) deliberately: same shape,
-- same single-use semantics, same cascade. Only the TTL differs — a reset link
-- is worth more than a verification code, so it lives for 60 minutes and is
-- burned the moment it is spent.
--
-- token_hash stores SHA-256 of the raw token. The raw token exists only inside
-- the email we send; a database leak therefore hands out nothing usable.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens(user_id);

-- Supports the "invalidate everything still outstanding for this user" sweep
-- that runs before each new link is issued.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_unused
  ON password_reset_tokens(user_id)
  WHERE used_at IS NULL;

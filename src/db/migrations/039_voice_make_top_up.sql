-- 039_voice_make_top_up.sql
--
-- MORE VOICE MAKES FOR CREDITS (Oct 2026). A phone-made request includes 5
-- ElevenLabs voice makes (config/requestLimits.ts MAX_VOICE_MAKES_PER_REQUEST).
-- Once they are used, the requester can buy 5 more for that request with
-- credits (VOICE_MAKE_TOP_UP). Each purchase is ONE ledger row:
--
--   credit_transactions.type         = 'voice_make_top_up'
--   credit_transactions.reference_id = the clip request's id
--   credit_transactions.amount       = -(credits charged)
--
-- The request's allowance is 5 + 5 × (number of those rows), so nothing else
-- is stored and the ledger stays the single source of truth.
--
-- Idempotent; re-running converges.
--   node scripts/apply-migration.js src/db/migrations/039_voice_make_top_up.sql

BEGIN;

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check CHECK (
    type IN (
      'signup_bonus', 'request_charge', 'request_refund',
      'admin_credit', 'admin_debit', 'discount_applied', 'top_up',
      'management_purchase', 'management_refund',
      'voice_make_top_up'
    )
  );

-- The allowance is read by request on every studio refresh.
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference_type
  ON credit_transactions (reference_id, type)
  WHERE reference_id IS NOT NULL;

COMMIT;

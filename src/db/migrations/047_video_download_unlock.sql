-- 047_video_download_unlock.sql
--
-- SINGLE VIDEO DOWNLOAD UNLOCK (2026-10-27).
--
-- A requester may spend VIDEO_DOWNLOAD_UNLOCK.priceCredits (39) credits to
-- unlock download of one free request for VIDEO_DOWNLOAD_UNLOCK.days (30)
-- days. Channel Management is NOT included.
--
-- Each unlock is ONE ledger row:
--   credit_transactions.type         = 'video_download_unlock'
--   credit_transactions.reference_id = the clip request id
--   credit_transactions.amount       = -(credits charged)
--
-- The `download_unlocked` and `videos_expire_at` columns already exist
-- (migration 040). No new columns are needed.
--
-- Idempotent; re-running converges.
-- DO NOT APPLY: Tho applies migrations.

BEGIN;

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check CHECK (
    type IN (
      'signup_bonus', 'request_charge', 'request_refund',
      'admin_credit', 'admin_debit', 'discount_applied', 'top_up',
      'management_purchase', 'management_refund',
      'voice_make_top_up',
      'video_download_unlock'
    )
  );

COMMIT;

-- Migration 018: Revert three foreign-project migrations applied by mistake
-- ============================================================================
-- The files migrations/2026_google_login.sql, migrations/2026_user_blocks.sql,
-- and migrations/2026_account_deletion_cascade.sql belong to a DIFFERENT
-- project (an Express app with src/routes/*.js and tables events/reviews/
-- conversations). They were run against this database by mistake.
--
-- This migration undoes ONLY what those files actually changed here, without
-- touching this project's real Google login (which lives in auth_identities,
-- NOT a users column) or its real account-deletion design (anonymize-in-place
-- + deleted_account_registry from migration 014).
--
-- Idempotent. Safe to run more than once. Apply with:
--   node scripts/apply-migration.js src/db/migrations/018_revert_foreign_project_migrations.sql
--
-- Run the discovery query first (see 018_discovery_before_revert.sql) to
-- confirm the live state matches the assumptions below.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Undo 2026_google_login.sql
--    It added an unused users.google_user_id column + unique index. Nothing in
--    this codebase references it (Google sign-in uses auth_identities). Drop it.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_users_google_user_id;
ALTER TABLE users DROP COLUMN IF EXISTS google_user_id;

-- ----------------------------------------------------------------------------
-- 2. Undo 2026_user_blocks.sql
--    It created an orphan user_blocks table (with its own indexes). Unused.
--    Dropping the table drops its indexes too.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS user_blocks;

-- ----------------------------------------------------------------------------
-- 3. Undo the ONE harmful change from 2026_account_deletion_cascade.sql
--    That file rewrote every FK pointing at users to ON DELETE CASCADE.
--    In this schema every such FK was ALREADY CASCADE except one:
--        mobile_store_purchases.user_id  (intended ON DELETE RESTRICT,
--        migration 015) — financial records must survive user deletion.
--    Restore RESTRICT on that constraint only, without hardcoding its name.
--    All other users-FKs are left as-is (they are correctly CASCADE).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    con_name text;
BEGIN
    -- Proceed only if the table exists (i.e. migration 015 was applied).
    IF to_regclass('public.mobile_store_purchases') IS NOT NULL THEN
        SELECT tc.constraint_name
          INTO con_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name
           AND kcu.table_schema    = tc.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema    = 'public'
           AND tc.table_name      = 'mobile_store_purchases'
           AND kcu.column_name    = 'user_id'
           AND ccu.table_name     = 'users'
         LIMIT 1;

        IF con_name IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.mobile_store_purchases DROP CONSTRAINT %I', con_name);
        END IF;

        ALTER TABLE public.mobile_store_purchases
            ADD CONSTRAINT mobile_store_purchases_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

        RAISE NOTICE 'Restored mobile_store_purchases.user_id -> users(id) ON DELETE RESTRICT';
    ELSE
        RAISE NOTICE 'mobile_store_purchases not present; nothing to restore';
    END IF;
END $$;

COMMIT;

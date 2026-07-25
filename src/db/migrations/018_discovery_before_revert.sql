-- Discovery (READ-ONLY): run this BEFORE 018_revert_foreign_project_migrations.sql
-- to confirm the live database matches the assumptions in the revert script.
-- Nothing here changes data. Apply with:
--   node scripts/apply-migration.js src/db/migrations/018_discovery_before_revert.sql
-- (or paste into psql). Eyeball the three result sets.

-- A. Did the stray google_user_id column / index land here? (expect rows if applied)
SELECT 'users.google_user_id column' AS check, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'google_user_id';

SELECT 'idx_users_google_user_id index' AS check, indexname
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'idx_users_google_user_id';

-- B. Did the orphan user_blocks table land here? (expect a row if applied)
SELECT 'user_blocks table' AS check, to_regclass('public.user_blocks')::text AS present;

-- C. Current ON DELETE rule for EVERY FK pointing at users.
--    After the mistaken cascade migration, mobile_store_purchases will show
--    CASCADE; it SHOULD be RESTRICT. Everything else should be CASCADE.
SELECT tc.table_name        AS child_table,
       kcu.column_name      AS child_column,
       tc.constraint_name,
       rc.delete_rule
  FROM information_schema.table_constraints  tc
  JOIN information_schema.key_column_usage   kcu
    ON kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema    = tc.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name  = tc.constraint_name
 WHERE tc.constraint_type = 'FOREIGN KEY'
   AND tc.table_schema    = 'public'
   AND ccu.table_name     = 'users'
 ORDER BY tc.table_name, kcu.column_name;

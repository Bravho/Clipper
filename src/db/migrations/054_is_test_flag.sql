-- Additive columns for Phase 2 LINE test mode; never applied by the application.
-- Tag LINE-intake records created during the Mar-PC test run so test data can
-- be distinguished from real production rows without touching existing data.
BEGIN;

ALTER TABLE line_accounts         ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE service_package_orders ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clip_requests         ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;

-- 038_ad_lab_workspaces.sql  (was 035_studio_workspaces.sql on feature/studio-lab;
-- renumbered because main already uses 035–037 for device render.)
-- Durable, per-owner state for the private Ad Lab (channel marketing) prototype.
-- The table keeps its original name, studio_workspaces, so a database where the
-- old 035 file was already applied needs no data move. Idempotent: safe to run
-- again on such a database.
-- owner_id is TEXT intentionally: the local Ad Lab login uses a stable textual
-- identity ("studio-local-owner") that is not a row in the production users
-- table. On production it is the RClipper user id.

BEGIN;

CREATE TABLE IF NOT EXISTS studio_workspaces (
  owner_id  TEXT        PRIMARY KEY
                        CHECK (length(trim(owner_id)) > 0),
  data      JSONB       NOT NULL DEFAULT
                        '{"brands":[],"drafts":[],"results":[],"publishingPlans":[],"selectedBrandId":""}'::jsonb
                        CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE studio_workspaces IS
  'Private Ad Lab brands, script drafts, analysis results, and publishing metadata, stored per owner.';

COMMIT;

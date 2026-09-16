-- 035_studio_workspaces.sql
-- Durable, per-owner state for the private Studio Lab prototype.
-- owner_id is TEXT intentionally: local Studio credentials use a stable textual
-- identity that is not a row in the production users table.

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
  'Private Studio Lab brands, script drafts, analysis results, and publishing metadata, stored per owner.';

COMMIT;

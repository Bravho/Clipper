-- Apply separately. Private sampled JPEGs follow LINE's seven-day retention;
-- owner cleanup must include this table (raw frames are never notifier payloads).
CREATE TABLE IF NOT EXISTS asset_visual_analyses (
  asset_id TEXT NOT NULL REFERENCES uploaded_assets(id) ON DELETE CASCADE,
  analysis_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','done','failed')),
  result JSONB,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(asset_id, analysis_version)
);
CREATE INDEX IF NOT EXISTS asset_visual_analyses_queue ON asset_visual_analyses(state,created_at);

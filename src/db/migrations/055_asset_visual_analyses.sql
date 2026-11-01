BEGIN;
-- Apply separately. Private sampled JPEGs follow LINE's seven-day retention;
-- owner cleanup must include this table (raw frames are never notifier payloads).
CREATE TABLE IF NOT EXISTS asset_visual_analyses (
  asset_id UUID NOT NULL REFERENCES uploaded_assets(id) ON DELETE CASCADE,
  analysis_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','done','failed')),
  result JSONB,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(asset_id, analysis_version)
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'asset_visual_analyses'::regclass
             AND attname = 'asset_id' AND atttypid = 'text'::regtype AND NOT attisdropped) THEN
    LOCK TABLE asset_visual_analyses IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM asset_visual_analyses) THEN
      RAISE EXCEPTION 'Cannot convert nonempty asset_visual_analyses.asset_id from text to uuid';
    END IF;
    ALTER TABLE asset_visual_analyses ALTER COLUMN asset_id TYPE UUID USING asset_id::uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'asset_visual_analyses'::regclass AND conname = 'asset_visual_analyses_asset_id_fkey') THEN
    ALTER TABLE asset_visual_analyses ADD CONSTRAINT asset_visual_analyses_asset_id_fkey
      FOREIGN KEY (asset_id) REFERENCES uploaded_assets(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS asset_visual_analyses_queue ON asset_visual_analyses(state,created_at);

COMMIT;

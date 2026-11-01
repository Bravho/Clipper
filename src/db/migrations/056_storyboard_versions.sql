BEGIN;
-- Apply separately before enabling LINE_SCENE_EDIT_ENABLED.
CREATE TABLE IF NOT EXISTS storyboard_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id UUID NOT NULL REFERENCES clip_requests(id),
 parent_version_id UUID REFERENCES storyboard_versions(id),
 scenes JSONB NOT NULL,
 created_by TEXT NOT NULL CHECK (created_by IN ('shop','admin','system')),
 reason TEXT NOT NULL,
 is_test BOOLEAN NOT NULL DEFAULT FALSE,
 dispatched_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'storyboard_versions'::regclass
             AND attname = 'request_id' AND atttypid = 'text'::regtype AND NOT attisdropped) THEN
    LOCK TABLE storyboard_versions IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM storyboard_versions) THEN
      RAISE EXCEPTION 'Cannot convert nonempty storyboard_versions.request_id from text to uuid';
    END IF;
    ALTER TABLE storyboard_versions ALTER COLUMN request_id TYPE UUID USING request_id::uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'storyboard_versions'::regclass AND conname = 'storyboard_versions_request_id_fkey') THEN
    ALTER TABLE storyboard_versions ADD CONSTRAINT storyboard_versions_request_id_fkey
      FOREIGN KEY (request_id) REFERENCES clip_requests(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS storyboard_versions_request ON storyboard_versions(request_id,created_at);
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS storyboard_version_id UUID REFERENCES storyboard_versions(id);
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS delivered_storyboard_version_id UUID REFERENCES storyboard_versions(id);
ALTER TABLE uploaded_assets ADD COLUMN IF NOT EXISTS storyboard_version_id UUID REFERENCES storyboard_versions(id);
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS storyboard_version_id UUID REFERENCES storyboard_versions(id);
ALTER TABLE storyboard_versions ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;

COMMIT;

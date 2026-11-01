-- Apply separately before enabling LINE_SCENE_EDIT_ENABLED.
CREATE TABLE IF NOT EXISTS storyboard_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id TEXT NOT NULL REFERENCES clip_requests(id),
 parent_version_id UUID REFERENCES storyboard_versions(id),
 scenes JSONB NOT NULL,
 created_by TEXT NOT NULL CHECK (created_by IN ('shop','admin','system')),
 reason TEXT NOT NULL,
 is_test BOOLEAN NOT NULL DEFAULT FALSE,
 dispatched_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS storyboard_versions_request ON storyboard_versions(request_id,created_at);
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS storyboard_version_id UUID REFERENCES storyboard_versions(id);
ALTER TABLE clip_requests ADD COLUMN IF NOT EXISTS delivered_storyboard_version_id UUID REFERENCES storyboard_versions(id);
ALTER TABLE uploaded_assets ADD COLUMN IF NOT EXISTS storyboard_version_id UUID REFERENCES storyboard_versions(id);
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS storyboard_version_id UUID REFERENCES storyboard_versions(id);
ALTER TABLE storyboard_versions ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;

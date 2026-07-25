-- Migration 017: combine video-generation feedback with AI safety reports.
-- Safe to run repeatedly after migration 015.

ALTER TABLE ai_content_reports
  ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'safety';

ALTER TABLE ai_content_reports
  ADD COLUMN IF NOT EXISTS rating SMALLINT;

ALTER TABLE ai_content_reports
  DROP CONSTRAINT IF EXISTS ai_content_reports_report_type_check;
ALTER TABLE ai_content_reports
  ADD CONSTRAINT ai_content_reports_report_type_check
  CHECK (report_type IN ('feedback', 'safety'));

ALTER TABLE ai_content_reports
  DROP CONSTRAINT IF EXISTS ai_content_reports_rating_check;
ALTER TABLE ai_content_reports
  ADD CONSTRAINT ai_content_reports_rating_check
  CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);

ALTER TABLE ai_content_reports
  DROP CONSTRAINT IF EXISTS ai_content_reports_reason_check;
ALTER TABLE ai_content_reports
  ADD CONSTRAINT ai_content_reports_reason_check CHECK (
    reason IN (
      'unsafe', 'sexual', 'violent', 'hate', 'privacy',
      'impersonation', 'copyright', 'misleading', 'other',
      'video_quality', 'scene_selection', 'motion_direction',
      'audio_music', 'subtitles', 'aspect_ratio', 'other_feedback'
    )
  );

CREATE INDEX IF NOT EXISTS idx_ai_content_reports_type_created
  ON ai_content_reports(report_type, created_at DESC);

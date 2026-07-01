-- Phase 7: motion-graphic template selection.
--
-- The requester picks a template at the merged-review step; the styled/captioned
-- video is rendered with it. 'none' (default) = clean full-bleed video +
-- subtitles only. See src/config/motionTemplates.ts.

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS selected_motion_template TEXT NOT NULL DEFAULT 'none';

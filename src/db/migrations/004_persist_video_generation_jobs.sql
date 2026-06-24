-- Persist AI video pipeline state in PostgreSQL.
--
-- Without this table/column set, VideoGenerationJob fell back to the in-memory
-- mock repository. Browser reloads could survive briefly, but server restarts
-- lost the current pipeline step and any in-flight provider task IDs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS video_generation_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step TEXT NOT NULL,
  failed_at_step TEXT,

  scene_plan TEXT,
  script_thai TEXT,
  script_english TEXT,
  script_chinese TEXT,
  hook_thai TEXT,
  hook_english TEXT,
  caption_thai TEXT,
  caption_english TEXT,
  caption_chinese TEXT,

  approved_scene_plan TEXT,
  approved_script_thai TEXT,
  approved_script_english TEXT,
  approved_script_chinese TEXT,
  approved_hook_thai TEXT,
  approved_hook_english TEXT,
  approved_caption_thai TEXT,
  approved_caption_english TEXT,
  approved_caption_chinese TEXT,

  video_gen_task_id TEXT,
  video_gen_task_ids TEXT,
  scene_video_asset_ids TEXT,
  video_gen_status TEXT,
  video_gen_last_polled_at TIMESTAMPTZ,
  base_video_asset_id TEXT,

  tts_task_id TEXT,
  eleven_labs_voice_id TEXT NOT NULL DEFAULT '',
  voice_recording_asset_id TEXT,
  processed_voice_asset_id TEXT,
  selected_music_track TEXT,
  voice_duration_seconds NUMERIC,
  voice_timestamps TEXT,

  subtitle_languages TEXT[] NOT NULL DEFAULT ARRAY['en','zh'],
  subtitle_timeline TEXT,
  animation_spec TEXT,
  animated_video_asset_id TEXT,
  animated_overlay_asset_ids TEXT,

  final_export_9_16_asset_id TEXT,
  final_export_16_9_asset_id TEXT,
  final_export_1_1_asset_id TEXT,
  final_export_4_5_asset_id TEXT,
  final_export_tvent_asset_id TEXT,

  content_approved_by TEXT,
  video_approved_by TEXT,
  voice_approved_by TEXT,
  animation_approved_by TEXT,
  final_approved_by TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'video_generation_jobs'
      AND column_name = 'kling_task_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'video_generation_jobs'
      AND column_name = 'video_gen_task_id'
  ) THEN
    ALTER TABLE video_generation_jobs RENAME COLUMN kling_task_id TO video_gen_task_id;
  END IF;
END $$;

DO $$
DECLARE
  id_type TEXT;
BEGIN
  SELECT data_type
    INTO id_type
  FROM information_schema.columns
  WHERE table_name = 'video_generation_jobs'
    AND column_name = 'id';

  IF id_type = 'uuid' THEN
    ALTER TABLE video_generation_jobs ALTER COLUMN id SET DEFAULT gen_random_uuid();
  ELSE
    ALTER TABLE video_generation_jobs ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
END $$;

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS failed_at_step TEXT,
  ADD COLUMN IF NOT EXISTS script_chinese TEXT,
  ADD COLUMN IF NOT EXISTS caption_chinese TEXT,
  ADD COLUMN IF NOT EXISTS approved_script_chinese TEXT,
  ADD COLUMN IF NOT EXISTS approved_caption_chinese TEXT,
  ADD COLUMN IF NOT EXISTS video_gen_task_id TEXT,
  ADD COLUMN IF NOT EXISTS video_gen_task_ids TEXT,
  ADD COLUMN IF NOT EXISTS scene_video_asset_ids TEXT,
  ADD COLUMN IF NOT EXISTS video_gen_status TEXT,
  ADD COLUMN IF NOT EXISTS video_gen_last_polled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tts_task_id TEXT,
  ADD COLUMN IF NOT EXISTS eleven_labs_voice_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voice_recording_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS processed_voice_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS selected_music_track TEXT,
  ADD COLUMN IF NOT EXISTS voice_duration_seconds NUMERIC,
  ADD COLUMN IF NOT EXISTS voice_timestamps TEXT,
  ADD COLUMN IF NOT EXISTS subtitle_languages TEXT[] NOT NULL DEFAULT ARRAY['en','zh'],
  ADD COLUMN IF NOT EXISTS subtitle_timeline TEXT,
  ADD COLUMN IF NOT EXISTS animation_spec TEXT,
  ADD COLUMN IF NOT EXISTS animated_video_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS animated_overlay_asset_ids TEXT,
  ADD COLUMN IF NOT EXISTS final_export_9_16_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS final_export_16_9_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS final_export_1_1_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS final_export_4_5_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS final_export_tvent_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS content_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS video_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS voice_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS animation_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS final_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_request_id
  ON video_generation_jobs(request_id);

CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_current_step
  ON video_generation_jobs(current_step);

-- Migration 003: Add selected_music_track column to video_generation_jobs
-- This column stores the background music track chosen by the requester before
-- submitting the voice recording. It is used by the FFmpeg composition step.

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS selected_music_track TEXT;

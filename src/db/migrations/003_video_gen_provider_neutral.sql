-- Migration: rename the Kling-specific video-generation column to a
-- provider-neutral name, after switching the pipeline's video generator from
-- Kling AI to Google Veo 3.1 Lite.
--
-- Only the persisted column is renamed here. The per-scene task IDs
-- (video_gen_task_ids), per-scene status and last-polled timestamp are not
-- yet materialised as DB columns (the pipeline currently runs on the in-memory
-- Mock repository); the optional ADD COLUMN statements below create them if
-- you later move video_generation_jobs onto PostgreSQL.
--
-- Run this against your database if schema.sql / earlier migrations were
-- already applied.

ALTER TABLE video_generation_jobs
  RENAME COLUMN kling_task_id TO video_gen_task_id;

-- Optional per-scene columns (safe to run repeatedly):
ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS video_gen_task_ids   TEXT,        -- JSON string[]
  ADD COLUMN IF NOT EXISTS scene_video_asset_ids TEXT,       -- JSON (string|null)[]
  ADD COLUMN IF NOT EXISTS video_gen_status      TEXT,       -- 'submitted' | 'processing'
  ADD COLUMN IF NOT EXISTS video_gen_last_polled_at TIMESTAMPTZ;

-- Phase 7: subtitle + motion-graphic overlay step.
--
-- After the merged voice+music master is approved, a transparent Remotion
-- overlay (captions in the requester-selected languages + motion graphics) is
-- composited ON TOP of the per-ratio masters into separate "captioned" exports
-- (the delivered videos). The masters in final_export_*_asset_id are left
-- untouched so the Travy EN+ZH render and any overlay re-render start clean.
--
-- 1. captioned_export_*_asset_id: the delivered captioned clip per ratio.
-- 2. tvent_video_status:          drives the background Travy-render spinner
--                                 ('idle' | 'generating' | 'ready' | 'failed').
--
-- subtitle_languages already exists (migration for the animation step). The
-- selected-language choice now flows from the merged-review step into the
-- overlay render rather than the old burned-in subtitle pass.

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS captioned_export_9_16_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS captioned_export_16_9_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS captioned_export_1_1_asset_id  TEXT,
  ADD COLUMN IF NOT EXISTS captioned_export_4_5_asset_id  TEXT,
  ADD COLUMN IF NOT EXISTS tvent_video_status TEXT NOT NULL DEFAULT 'idle';

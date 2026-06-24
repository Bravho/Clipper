-- Real-media montage migration.
--
-- Pivots the default base-video engine from Veo generative video to a
-- Remotion montage built from the client's actual uploaded photos/clips, and
-- adds the Stage-1 storyboard artifact that seeds the Stage-3 scene design.
--
-- 1. video_engine:      "montage" (default) | "veo" — which engine produced the
--                       base video. Veo is now only the no-media fallback or the
--                       optional AI add-on.
-- 2. ai_broll_enabled:  whether the optional Veo "AI intro/B-roll" add-on is on.
-- 3. storyboard:        JSON StoryboardScene[] generated at Stage 1 (rough).
-- 4. approved_storyboard: JSON StoryboardScene[] approved with the script;
--                       seeds Stage-3 montage design, shown read-only at Stage 2.
--
-- The richer per-scene montage data (ScenePlan.assets / transitionIn) rides
-- inside the existing approved_scene_plan JSON, so no extra columns are needed
-- for it. scene_video_asset_ids keeps its column; only its meaning changes
-- (cumulative Veo output -> per-scene montage segments) once Phase 3 lands.

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS video_engine TEXT NOT NULL DEFAULT 'montage',
  ADD COLUMN IF NOT EXISTS ai_broll_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS storyboard TEXT,
  ADD COLUMN IF NOT EXISTS approved_storyboard TEXT;

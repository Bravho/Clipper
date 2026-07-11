-- 011_asset_duration_seconds.sql
--
-- Persist a video clip's real playback duration (seconds) on its uploaded-asset
-- record. The value is probed server-side with ffprobe at the upload-confirmation
-- step (the same probe that already enforces MAX_CLIP_DURATION_SECONDS), so
-- storing it here costs nothing extra. Downstream steps (e.g. the storyboard /
-- voice-length estimate) then use a clip's true length instead of a flat guess.
--
-- Nullable: images and clips uploaded before this column existed simply have NULL
-- and fall back to the flat per-asset estimate.

ALTER TABLE uploaded_assets
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC;

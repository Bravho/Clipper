-- Phase 8: distribution-review step publishing drafts.
--
-- After the captioned videos for every selected channel are approved, the
-- requester reviews an auto-filled (Gemini-generated) publishing form per
-- channel — title/caption/hashtags — editable before posting. The edited
-- drafts (and, after confirm, each channel's posting result) are stored here
-- as a JSON array of ChannelPublishingDraft. See
-- src/domain/models/VideoGenerationJob.ts.

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS publishing_drafts JSONB;

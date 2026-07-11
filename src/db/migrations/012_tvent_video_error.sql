-- 012_tvent_video_error.sql
--
-- Persist WHY the automatic background Travy (EN+ZH) render failed. Previously a
-- Travy failure only set tvent_video_status = 'failed' and the requester saw a
-- generic "contact admin" message, with the real cause buried in server logs.
--
-- This column stores the captured error message (truncated) so the reason is
-- shown in the distribution-review UI and support can diagnose without logs. It
-- is cleared when a retry starts and on success.
--
-- Nullable: null whenever the Travy render has not failed.

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS tvent_video_error TEXT;

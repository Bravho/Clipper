-- Migration 041: studio behaviour events (admin analytics)
--
-- WHY. The studio is now the one way to make a video, and most of what a new
-- user does in it never reaches the server: opening the studio, picking photos,
-- leaving on the storyboard, remaking the voice three times. The server only saw
-- the pipeline boundaries (a Draft, a submission, an approval), so the admin
-- funnel could not say where people who never submitted gave up, and the old
-- "approval clicks" page measured staff/express-lane gates that no longer exist.
--
-- One row per event, append-only, written fire-and-forget by
-- POST /api/analytics/studio-events. Names are allow-listed in
-- src/config/studioEvents.ts. A failed insert never affects the studio.
--
-- request_id is TEXT with no foreign key: clip_requests.id is uuid in some
-- environments and text in others (see migrations 006, 019, 028).
--
-- Additive and idempotent. Apply with:
--   node scripts/apply-migration.js src/db/migrations/041_studio_events.sql

CREATE TABLE IF NOT EXISTS studio_events (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- One studio visit (opened → left), minted on the phone.
  session_id  TEXT        NOT NULL,
  request_id  TEXT,
  -- studio_open | step_view | action
  kind        TEXT        NOT NULL,
  -- brief | source | scenes | audio | style | render | channels
  step        TEXT,
  -- e.g. submitted, voice_regenerated, render_failed (see studioEvents.ts)
  action      TEXT,
  detail      JSONB,
  -- ios | android | web, from the RClipperNative/<platform> user agent
  surface     TEXT,
  -- When it happened on the phone (clamped server-side), and when it arrived.
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio_events_occurred
  ON studio_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_studio_events_user
  ON studio_events (user_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_studio_events_session
  ON studio_events (session_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_studio_events_action
  ON studio_events (action, occurred_at DESC)
  WHERE action IS NOT NULL;

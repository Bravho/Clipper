-- Migration 036: device-held source media and device-only render work
--
-- WHY. Until now a clip the requester shot on their phone had to be uploaded
-- before anything could be made from it: the render ran on the Mac Mini, and a
-- renderer cannot use footage it does not have. That is the whole cost of the
-- current design — a 200 MB clip goes up over mobile data before the requester
-- sees a single frame of their video.
--
-- With the phone able to render the montage, the master and the final export
-- itself, the original never needs to leave the device. What the server keeps
-- instead is a small poster frame (for Gemini, for the scene designer, and for
-- every screen that shows a thumbnail) plus an opaque handle naming the file in
-- the private storage of the app. Voice generation, script generation and publishing
-- are unaffected — they were always small-data calls.
--
-- Three columns make that safe:
--
--   uploaded_assets.device_local_id
--     The handle. Non-null means "the bytes for this asset live on the
--     phone of the requester and nowhere else. Everything that resolves an asset to
--     a render URL has to branch on it, so it is a column rather than a
--     convention buried in a filename.
--
--   clip_requests.render_location
--     server (the default, and every existing row) keeps current behaviour
--     exactly: uploads, the render queue, the Mac Mini worker. device means
--     the heavy steps of this request can only run on the phone that holds the
--     media. Recorded at submission, because that is when we know whether the
--     originals were retained locally.
--
--   render_tasks.device_only
--     The enforcement. A task for a device-rendered request is invisible to the
--     claim scan of the Mac worker, so it can never pick up a step whose
--     source footage it has no copy of and fail it. Defaulting to false means
--     every row that exists today, and every server-path job from here on,
--     behaves precisely as before.
--
-- Additive, idempotent, and backwards-compatible in the direction that matters:
-- an older installed app never sets any of these, so it keeps uploading and
-- keeps rendering on the Mac Mini. Apply with:
--   node scripts/apply-migration.js src/db/migrations/036_device_held_media.sql

-- ── The handle for media that stays on the phone ────────────────────────────
ALTER TABLE uploaded_assets
  ADD COLUMN IF NOT EXISTS device_local_id TEXT;

COMMENT ON COLUMN uploaded_assets.device_local_id IS
  'Opaque handle into the app''s private storage on the requester''s device. '
  'Non-null means the original bytes were never uploaded: storage_url points at '
  'a small poster derivative used for analysis and thumbnails only, and any '
  'render that needs the real frames must run on that device.';

-- The device-render planner asks "does this request have any device-held
-- media" on every claim. A partial index keeps that a lookup rather than a scan
-- as the table grows, since only a minority of assets are ever device-held.
CREATE INDEX IF NOT EXISTS idx_uploaded_assets_device_local
  ON uploaded_assets (request_id)
  WHERE device_local_id IS NOT NULL;

-- ── Where the heavy steps of a request may run ─────────────────────────────
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS render_location TEXT NOT NULL DEFAULT 'server';

COMMENT ON COLUMN clip_requests.render_location IS
  '''server'' = uploads + the Mac Mini render queue (the default, and every '
  'pre-existing request). ''device'' = the originals stayed on the requester''s '
  'phone, so the montage, the merged master and the final export must be '
  'rendered there. AI calls, approvals, credits and publishing are server-side '
  'either way.';

-- Guard the value rather than trusting every writer: a typo here would silently
-- route the work of a request to nobody.
--
-- Written as DROP-then-ADD rather than as a DO block with an exception handler.
-- Both are idempotent, but a DO block is dollar-quoted, and a SQL console that
-- splits input on semicolons chops the block apart at the semicolons inside it
-- and reports a syntax error on a statement the author never wrote. These two
-- statements survive being split, so the file can be pasted into a console as
-- well as fed to `scripts/apply-migration.js`, which sends it whole.
--
-- The tradeoff: DROP-then-ADD leaves the column briefly unguarded. Sent whole
-- the two run in one implicit transaction and the gap does not exist. Split by
-- a console they are two transactions, so a concurrent write of a bad value
-- could slip through a window of microseconds. Acceptable for a migration
-- applied once during a deploy, and worth stating rather than discovering.
ALTER TABLE clip_requests
  DROP CONSTRAINT IF EXISTS clip_requests_render_location_check;

ALTER TABLE clip_requests
  ADD CONSTRAINT clip_requests_render_location_check
  CHECK (render_location IN ('server', 'device'));

-- ── Work the Mac worker must not take ───────────────────────────────────────
ALTER TABLE render_tasks
  ADD COLUMN IF NOT EXISTS device_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN render_tasks.device_only IS
  'TRUE when this step''s source media lives only on the requester''s device. '
  'The worker''s claim scan excludes these rows, so it can never claim a step '
  'it would have to fail. FALSE (the default) is the existing behaviour.';

-- The claim scan of the worker is the hottest query against this table and now
-- filters on device_only as well as state. Rebuilding the partial index to
-- match keeps it covering the exact rows the scan considers.
DROP INDEX IF EXISTS idx_render_tasks_active;
CREATE INDEX IF NOT EXISTS idx_render_tasks_active
  ON render_tasks (priority DESC, enqueued_at)
  WHERE state IN ('queued', 'claimed');

CREATE INDEX IF NOT EXISTS idx_render_tasks_worker_claimable
  ON render_tasks (priority DESC, enqueued_at)
  WHERE state IN ('queued', 'claimed') AND device_only = FALSE;

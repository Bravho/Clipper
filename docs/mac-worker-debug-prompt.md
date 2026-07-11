# Claude Code prompt — debug Mac worker montage render failure

Paste the block below into **Claude Code running on the Mac Mini** (in the repo). Context:
the DigitalOcean droplet offloads heavy renders to this Mac via a Postgres queue. A montage
render step (`montage_all_segments`) is being claimed by this worker and failing ~instantly,
so the pipeline shows "failed" with no error on the droplet — the real error is here.

---

```
You are debugging the RClipper render worker on this Mac Mini. Repo:
/Users/admin/Projects/Video_Processor_RClipper (adjust if different). This machine runs
scripts/render-worker.ts as a launchd service (label com.rclipper.worker). It claims heavy
pipeline steps from the shared managed Postgres and runs them via
VideoGenerationService.runQueuedRenderStep → for step `montage_all_segments` that is
_renderAllSceneSegments → renderScene (Remotion "MontageScene" composition, which launches
headless Chromium) → uploads each segment to DO Spaces.

CONFIRMED FROM THE DATABASE:
- A job just failed: request c748a4cc-85df-4f77-9684-b75a215ac642, render_step
  montage_all_segments, render_state=failed, claimed_by=admins-Mac-mini.local, and it failed
  < 1 second after being claimed (current_scene_index=0, no segments produced). So it throws
  at the very START of the render, before rendering scene 0. This is an environment/setup/code
  error, NOT a timeout or resource limit.
- video_engine is montage (Veo is not involved).

Worker logs (launchd StandardOut/StandardError):
  /Users/admin/Library/Logs/rclipper/worker.out.log
  /Users/admin/Library/Logs/rclipper/worker.err.log

DO THIS, showing me findings as you go and asking before anything destructive:

1. Read the tail of both worker logs and find the failure. Look for a line like
   "step FAILED ... step: montage_all_segments ... error: <MESSAGE>" and any stack trace or
   Remotion/Chromium/ffmpeg error near it. Quote the exact error message — that drives
   everything else. (grep -iE "FAILED|error|remotion|chromium|headless|ffmpeg|ENOENT|spaces|
   ECONN|bundl" on the logs.)

2. Based on the error, check the most likely causes IN THIS ORDER and report each:
   a. Remotion headless browser missing → run `npx remotion browser ensure` and re-check.
      Also try a standalone smoke render:
      `cd <repo> && npx remotion render remotion/index.ts MontageScene /tmp/scene-smoke.mp4 --props='{}' --log=verbose`
      (if MontageScene needs props, render the "Overlay" composition instead as the smoke test).
   b. .env.local on this Mac: confirm FFMPEG_PATH points at a real ffmpeg (`which ffmpeg`),
      FFMPEG_FONT_FILE is a real Thai .ttf/.otf on macOS (NOT a Windows tahoma path),
      FFMPEG_TMP_DIR exists and is writable, and DO_SPACES_* + PG* are all set. `ffmpeg -version`
      should show libx264/libass.
   c. Code freshness: `git status` and `git log --oneline -3`. Is this worker on the same
      commit the droplet expects? If it's behind, pull (confirm the branch with me first).
      Ensure `npm ci` has been run if package-lock changed. Confirm node_modules is present.
   d. Node version mismatch vs the droplet (Remotion is version-sensitive). Report `node -v`.
   e. Spaces reachability: `node scripts/test-spaces.js`. Postgres reachability per
      docs/mac-worker-setup.md section 6.

3. Fix the specific cause the log points to (most often 2a or 2b). Make the smallest change
   that resolves it. Do NOT change pipeline compute logic. Ask before editing .env.local or
   the launchd plist.

4. Verify the fix without needing the website: re-run the worker for a single step:
   `npx tsx scripts/render-worker.ts --once` and watch it claim + complete a step (I will
   re-queue by clicking "ลองอีกครั้ง" / retry on the site, which sets the job back to queued).
   Then confirm from the DB that render_state went to 'done' and the job advanced past
   generating_base_video.

5. Reload the launchd service so the long-running worker picks up any change:
   `launchctl kickstart -k gui/$(id -u)/com.rclipper.worker`, then tail worker.out.log to
   confirm it's heartbeating and idle-polling cleanly.

Summarize at the end: the exact error from the log, the root cause, the fix applied, and
whether a montage_all_segments step then completed successfully.
```

---

## Most likely answer

A sub-second failure at scene 0 almost always means Remotion couldn't launch its headless
browser (needs `npx remotion browser ensure` on this Mac) or the bundle/env is off. The log's
`error:` string will say which. The worker reuses the same compute the web server would run,
so there's nothing pipeline-specific to change here — it's a Mac environment fix.

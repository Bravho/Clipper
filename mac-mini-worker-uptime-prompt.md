# Claude Code prompt — run in the `Video_Processor_RClipper` worker repo on the Mac Mini

Goal: stop heavy render steps from silently falling back to running INLINE on the web
server. When the render worker isn't alive at dispatch time, the web app's
`_dispatchHeavy` runs the step inline on the droplet, which (a) defeats the whole
offload design and (b) strands the job if the droplet restarts mid-render (the symptom
we just saw: a job stuck on `generating_overlay` with `render_state = done`). Fix the
worker's uptime + heartbeat so it's reliably "alive", make render steps
idempotent/resumable so any retry is safe, and make failures propagate.

Investigate before editing — don't assume file names or the launchd label.

## Task 1 — Keep the worker alive and "fresh"

The web app treats a worker as alive only if a worker heartbeat is newer than
`RENDER_WORKER_FRESH_SECONDS` (default 45s). Our logs show the worker getting SIGTERM'd
and taking seconds-to-minutes to come back (`received SIGTERM, draining …` → `stopped` →
`starting`). During that gap every dispatched step runs inline. Close the gap:

1. **launchd**: find the worker's launchd plist (label looks like `com.rclipper.worker`;
   check `~/Library/LaunchAgents/` and `/Library/LaunchDaemons/`). Confirm:
   - `KeepAlive` is `true` (or `{ Crashed = true; }`) so it auto-restarts on exit/crash.
   - `ThrottleInterval` is small (e.g. 5–10s) so restarts are fast, not throttled to 10s+.
   - `RunAtLoad` is `true`.
   Print the current plist and the diff you apply.
2. **Who sends SIGTERM?** Determine why it's being terminated (deploy script?
   `launchctl kickstart -k`? a cron? OOM?). If it's the deploy, that gap is expected —
   minimize it (see Task 3). If it's something else, fix or document it.
3. **Heartbeat on boot**: make the worker write its heartbeat IMMEDIATELY on startup,
   before its first poll, so the "alive" window is fresh the instant it's back — don't
   wait a full `heartbeatMs` (10s) tick. Verify the heartbeat write path actually
   updates whatever `isRenderWorkerAlive` reads (worker heartbeat row/table), and that
   `RENDER_WORKER_FRESH_SECONDS` (45s) comfortably exceeds `heartbeatMs` (10s).
4. **Report** the observed restart gap before vs after (SIGTERM → next fresh heartbeat).

## Task 2 — Make render steps idempotent / resumable

So that a stalled-retry (the web app now offers one) or a stale-claim reclaim re-runs a
step safely, with no duplicate/partial artifacts:

1. **Compose** (`_runFFmpegComposition`) is already per-ratio and merges each
   `finalExport_*` as it lands — confirm re-running it SKIPS ratios that already have an
   asset id (don't recompute/re-upload a ratio that's done) or, if it does recompute,
   that it overwrites cleanly and doesn't leave orphaned Spaces objects.
2. **Overlay** (`_runOverlayComposition`) and **additional ratios**
   (`_runAdditionalRatiosOverlay`): ensure a re-run overwrites its output deterministically
   and advances `current_step` only after a fully successful upload — never leave a
   half-written state that reads as "done".
3. Clean up scratch files on both success and failure so a restart doesn't accumulate
   disk under `/Users/Shared/clipper-scratch`.

## Task 3 — Propagate failures + drain cleanly

1. **Failure propagation** (if not already done): when `runQueuedRenderStep(job)` throws,
   the worker must, in its catch, set the job's `render_state = "failed"` AND call
   `await videoGenerationService.recordRenderStepFailure(job)` so `current_step` advances
   to `Failed`. The web app's `reconcileFailedRender` safety net only fires on
   `render_state = "failed"`, and the requester's failure panel needs `current_step = Failed`.
2. **Drain**: on SIGTERM, finish the in-flight step before exiting (the log shows it
   drains 0 — confirm it also drains when a step IS in flight, rather than abandoning a
   claim that then has to wait for the stale-claim window). Keep the drain bounded so
   launchd doesn't SIGKILL it.

## Deliverable

- The launchd plist diff and the measured restart-gap improvement.
- What (if anything) was sending SIGTERM, and whether it's expected.
- The idempotency changes per render step, and confirmation that re-running a
  half-done compose/overlay is safe.
- Confirmation the failure path sets `render_state=failed` + advances `current_step` to
  `Failed`.
- A live test: kill the worker mid-overlay, confirm launchd restarts it within a few
  seconds, it re-claims the stale/queued step, and the job completes — without the web
  server ever running the step inline.

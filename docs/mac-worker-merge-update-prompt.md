# Claude Code prompt — Mac Mini render worker (montage-merge update)

Paste everything in the fenced block below into **Claude Code running on the Mac Mini**
(inside the repo). Context: the web droplet was just changed so the montage **merge**
step (FFmpeg concat/crossfade of the approved scene segments) is now enqueued for this
Mac worker instead of running on the droplet. The worker code is generic and already
handles any queued step, so **no source change is expected here** — this task is to pull
the latest code, confirm the environment, make sure the worker is actually running, and
prove it claims and completes a `montage_merge` step.

---

```
You are working on the RClipper render worker on this Mac Mini. The repo is at
~/Projects/Video_Processor_RClipper (adjust if different). This machine is the
outbound-only render worker described in docs/mac-worker-setup.md and
docs/mac-worker-launchd.md. It talks directly to the shared managed Postgres and
DO Spaces — it never accepts inbound connections.

BACKGROUND (what changed on the server side):
The web droplet used to run the montage MERGE (FFmpeg concat/crossfade that joins the
approved per-scene segments into the single base video) inline on the 1 GB droplet, and
it was failing there. The droplet now dispatches that step through the existing render
queue as a new RenderStep value `montage_merge` (enum: src/domain/enums/RenderStep.ts;
worker dispatch: VideoGenerationService.runQueuedRenderStep switch). The worker
(scripts/render-worker.ts) already runs whatever step is queued via runQueuedRenderStep,
so once this repo is on the latest code, the worker handles `montage_merge` automatically.
render_step is a plain TEXT column, so no DB migration is needed.

DO THESE STEPS, pausing to show me output before anything destructive:

1. Sync code. Show `git status` and `git log --oneline -5` first. Then pull the latest
   from the same branch the droplet deploys (confirm the branch with me if it isn't
   obvious). After pulling, run `npm ci` only if package-lock.json changed. Confirm the
   file src/domain/enums/RenderStep.ts contains a `MontageMerge = "montage_merge"` entry
   and that VideoGenerationService.runQueuedRenderStep has a `case RenderStep.MontageMerge`.
   If either is missing, STOP and tell me — the pull didn't include the server change.

2. Sanity-check the environment WITHOUT changing it. Verify .env.local exists and that
   FFMPEG_PATH, FFMPEG_FONT_FILE (a Thai-capable .ttf/.otf, NOT the Windows tahoma path),
   FFMPEG_TMP_DIR, DO_SPACES_* and PG* are all set. Run `node -v` and compare to the
   droplet's Node version if you know it. Confirm `ffmpeg -hide_banner -buildconf` shows
   libass + libfreetype. Do not edit .env.local unless something is clearly wrong; if it
   is, ask me before writing.

3. Confirm connectivity from this Mac: run the Spaces test (scripts/test-spaces.js) and a
   quick Postgres SELECT against video_generation_jobs (see the snippet in
   docs/mac-worker-setup.md section 6). Both must succeed.

4. Do a ONE-SHOT worker run to prove the merge path end to end WITHOUT leaving a daemon
   running yet: `npx tsx scripts/render-worker.ts --once`. Report what it printed — whether
   it claimed a step, which step, and whether it completed or idled (idle is fine if the
   queue is empty right now).

5. Make sure the worker runs continuously and survives reboot/sleep. Check whether the
   launchd service from deploy/launchd/com.rclipper.worker.plist is already loaded
   (`launchctl list | grep -i rclipper`). If it is, reload it so it picks up the new code
   (`launchctl kickstart -k` or unload+load per docs/mac-worker-launchd.md) and show me the
   result. If it is NOT installed yet, follow docs/mac-worker-launchd.md to install and load
   it, then show me `launchctl list | grep rclipper` and the last 30 lines of its stdout log.

6. Prove liveness from the database's point of view: query render_worker_heartbeat and show
   me that this worker's last_seen_at is within the last ~15 seconds (the droplet only
   enqueues when a heartbeat is fresher than RENDER_WORKER_FRESH_SECONDS, default 45s). Then
   tail the worker log while I trigger an "Approve all" on the site, and show me the lines
   where it claims a `montage_merge` step and logs "step done". If it logs "step FAILED",
   capture the full error (the server-side ffmpeg logging was improved to print signal/exit
   code, so a memory kill will now say signal=SIGKILL rather than empty output).

Constraints: don't modify pipeline logic or the worker's compute — the fix is on the
droplet. Your job is deployment + verification. Ask before editing any env or launchd file.
Summarize at the end: code synced (Y/N), worker running under launchd (Y/N), heartbeat
fresh (Y/N), and a montage_merge step observed completing (Y/N).
```

---

## Why this is enough

The worker is a generic step-runner: it claims whatever `render_step` is queued and calls
`VideoGenerationService.runQueuedRenderStep(job)`, which now includes the `montage_merge`
case. Because merge inputs/outputs move through DO Spaces (shared) and the queue lives in
the shared managed Postgres, the Mac worker needs **no new code** — only the latest checkout
and a live heartbeat.

## The one gotcha that matters

The droplet only offloads when a worker heartbeat is **fresh (≤ 45 s)**. If the Mac worker
is asleep or not running, the droplet falls back to running the merge **inline on itself** —
which is exactly the failure you saw. So the real win depends on the launchd service staying
up (step 5–6). Consider disabling App Nap / auto-sleep for this Mac, or ensuring it's set to
never sleep while on power.

# Claude Code handoff prompt — RClipper (Mac render worker + droplet/client work)

Paste everything below the line into Claude Code (running in the repo on your main coding
machine). It briefs Claude Code on the work just completed, the current deployment state, the
guardrails, and what to do next.

---

You are continuing an in-progress project, **RClipper** (`clipper-platform`), a Next.js 14 /
TypeScript app that turns a client's uploaded photos/clips into short marketing videos through
an AI pipeline. Read `CLAUDE.md` first — it defines the layer structure (domain → repositories
→ services → app/features), the repository swap point (`src/repositories/index.ts`), the AI
video pipeline, the request/status lifecycle, and the seed accounts. Also skim
`docs/storage-lifecycle-design.md` (esp. Addenda A and B).

## Topology

- Web app runs on a DigitalOcean droplet at `178.128.63.236`.
- Object storage is DigitalOcean Spaces, region `sgp1` (S3-compatible), via `src/lib/spaces.ts`.
- Job/request state is in managed cloud PostgreSQL (`src/repositories/postgres/*`).
- A **Mac Mini (M4, 16 GB)** is now a dedicated, outbound-only render worker: it polls Postgres
  for queued heavy steps, pulls/pushes Spaces, and runs them. No inbound port/tunnel.
- The **live** base-video engine is the real-media montage engine
  (`src/lib/ai/montageService.ts` + `remotionService.ts` + `ffmpegService.ts`) orchestrated by
  `src/services/VideoGenerationService.ts`. `veoService.ts` / `ai_videos` are **legacy — do not
  build on them.**

## What was just built (Phases 1–3 of the Mac-worker offload) — already committed on the Mac

**Phase 1 — additive render-queue "claim" seam (web side), backwards-compatible.** With no
worker present, every heavy step runs inline exactly as before; when a worker heartbeat is
fresh, the step is enqueued instead.
- `src/db/migrations/010_render_queue.sql` — adds `render_state` (queued|claimed|done|failed),
  `render_step`, `render_payload` (jsonb), `claimed_by`, `claimed_at`, `render_heartbeat_at` to
  `video_generation_jobs`, plus a `render_worker_heartbeat` table. **Already applied to the
  shared managed Postgres.**
- `src/domain/enums/RenderStep.ts` — the 6 offloadable heavy steps + `RENDER_STEP_FAILED_AT`
  map + `isRenderStep`.
- `src/config/renderQueue.ts` — knobs (`enabled`, `workerFreshSeconds` 45s, `staleClaimSeconds`
  600s, `heartbeatIntervalMs`, `pollIntervalMs`, `concurrency`), all env-overridable.
- Repo layer: `IVideoGenerationJobRepository` + Postgres + Mock gained `recordWorkerHeartbeat`,
  `isRenderWorkerAlive`, `claimNextQueuedRenderStep` (Postgres uses `SELECT … FOR UPDATE SKIP
  LOCKED` with stale-claim reclaim), `touchRenderClaim`, `completeRenderClaim`. Domain model
  `VideoGenerationJob` gained the matching optional fields.
- `src/services/VideoGenerationService.ts` — new `_dispatchHeavy(job, renderStep, inlineFn,
  payload?)` seam replaces the old `this._heavyMethod(x).catch(handler)` pattern at **all 13**
  heavy call sites (montage scene/all-segments, animation, ffmpeg composition, overlay,
  additional-ratios, including the `retryPipeline` paths). It enqueues when a worker is alive,
  else runs inline. Also `runQueuedRenderStep(job)` (worker entrypoint — dispatches to the SAME
  private compute methods, nothing reimplemented) and `recordRenderStepFailure(job)`.
- Tests: `tests/repositories/renderQueue.test.ts` (claim-once, stale reclaim, heartbeat
  liveness, complete) and two seam tests in `tests/services/VideoGenerationService.test.ts`
  (enqueue-when-alive vs inline fallback).
- Also fixed 3 pre-existing Phase-7 overlay test failures (all test-only): added
  `splitSegmentsForDisplay` to the `geminiSubtitlesService` mock, mocked `@/lib/spaces` so the
  duration probe doesn't hit the network, and rewrote `flushBackground` to poll a predicate
  against a wall-clock deadline (was flaky under parallel load).

**Phase 2 — the worker process.**
- `scripts/render-worker.ts` — long-running, outbound-only. Each slot claims one step via `FOR
  UPDATE SKIP LOCKED`, runs it through `runQueuedRenderStep` (which streams its own inputs from
  Spaces and pushes outputs back with `ACL:"public-read"` unchanged), marks it done/failed,
  wipes its `FFMPEG_TMP_DIR/job-*` scratch in a `finally`. Advertises a heartbeat, keeps
  in-flight claims alive so long renders aren't reclaimed, concurrency cap (1–2), stale-scratch
  sweep on boot, graceful SIGTERM drain, per-step timing logs. Run: `npm run worker` (long) or
  `npm run worker:once`.
- `scripts/bootstrapEnv.ts` — loads `.env.local` before the pg pool initializes (imported first).
- `package.json` — added `tsx` + `dotenv` dev-deps and the `worker`/`worker:once` scripts.

**Phase 3 — run as services (Mac).**
- `scripts/run-worker.sh` (wraps the worker in `caffeinate -s`), `scripts/run-retention-sweep.sh`.
- `deploy/launchd/com.rclipper.worker.plist` (KeepAlive, restart on crash/reboot),
  `deploy/launchd/com.rclipper.retention-sweep.plist` (daily 03:30, **ships in `--dry-run`**).
- `docs/mac-worker-setup.md` (Phase 0 Mac tooling) and `docs/mac-worker-launchd.md` (install +
  acceptance runbook).

## Current deployment state

- Migration 010 is **applied** to the shared managed Postgres.
- The Mac worker LaunchAgent is **installed and running**, heartbeating every ~10s.
- The retention-sweep LaunchAgent is installed and **in dry-run** (deletes nothing yet).
- The Phase 1–3 changes are **committed on the Mac but NOT yet on the droplet** — `git push
  origin main` was blocked by a GitHub token-permission (403) issue. **Until the droplet runs
  this code, the Mac worker sits idle** (the droplet is what decides to enqueue). Getting this
  code onto the droplet is the first task below.
- `npm test` → **282 passing, 26 suites** (stable). `npx tsc --noEmit` has **12 pre-existing,
  unrelated errors** (e.g. `Role.Editor`, `AutoCancelled` badge, a `thumbnails.ts` es2018
  regex, some `updates[…]=id` assignments) — the project gates on ts-jest, not tsc.

## Guardrails (do not violate)

1. Keep `npm test` green at 282+. Add **zero net-new** tsc errors (verify with a line-agnostic
   diff of `npx tsc --noEmit` against the baseline before/after your change).
2. **Do NOT change the `ACL:"public-read"` behaviour anywhere.** That privatisation migration
   is intentionally deferred (see `storage-lifecycle-design.md` Addendum B.6).
3. Keep changes **additive and backwards-compatible**: the droplet must keep working with no
   Mac present (enqueue only when a worker heartbeat is fresh, else run inline).
4. Reuse the existing compute in `VideoGenerationService` — don't reimplement montage/overlay/
   ffmpeg logic in the worker.
5. Repositories are only wired in `src/repositories/index.ts`; pipeline jobs are Postgres-backed.

## Immediate next steps

1. **Deploy Phase 1 to the droplet.** Fix the GitHub push (refresh a token with `repo` /
   Contents:write scope, or switch the remote to SSH) OR apply the changes as a patch. Then on
   the droplet: `git pull`, `npm ci`, `npm run build`, restart the app. No DB step (migration
   already applied). Confirm the droplet enqueues: after driving a request to a heavy step,
   `~/Library/Logs/rclipper/worker.out.log` on the Mac shows `claimed step … step done …`.
2. **End-to-end + resilience acceptance** (see `docs/mac-worker-launchd.md` §4): submit a test
   request, watch it advance through the gates to a final clip in all ratios; kill the worker
   mid-job → claim is reclaimed and resumes; worker off past the heartbeat window → droplet
   fallback completes the step.
3. **Retention go-live decision** — it's in dry-run; review the daily dry-run output for a few
   days, then remove the `--dry-run` string from the retention plist and re-bootstrap.

## Continuing client-side / droplet development

The requester-facing UI and the storage-lifecycle UX are the natural next area. See
`storage-lifecycle-design.md` Addendum A.5 (inline retention text notes — some already wired:
`src/features/requests/components/RetentionNoteText.tsx`, `src/lib/retentionNotes.ts`, the
requester request page) and A.6 / B.6 for the remaining app work (e.g. `AutoCancelled` status
handling, optional dedicated `deliveredAt`/`lastActivityAt` columns). The presigned-URL /
private-uploads work in B.6 is deferred and tied to the `ACL:"public-read"` guardrail — do not
start it without the user's explicit go-ahead.

**Before doing client-side feature work, ask the user which features/priorities they want next
for the client side** — don't assume. Then proceed test-first, keeping the suite green.

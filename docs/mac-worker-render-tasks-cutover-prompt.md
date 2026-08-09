# Claude Code prompt — update the Mac Mini render worker to the render_tasks FIFO queue

Copy everything in the block below into a **Claude Code session running on the Mac Mini**
(in the `clipper_agent` repo checkout that the worker runs from). It updates and verifies
the worker against the new flat FIFO render-task queue.

---

You are working on the RClipper render worker, which runs on THIS Mac Mini and processes
the heavy video steps for the web app. The web app was just changed: the Mac Mini render
queue moved from the old single mutable claim columns on `video_generation_jobs`
(`render_state` / `render_step`, migration 010) to a dedicated **flat FIFO queue table**
`render_tasks` (migration `025_render_task_queue.sql`).

The queue is now ONE line of individual STEPS mixed across all requesters, claimed strictly
oldest-first (e.g. #1 user B's subtitle overlay, #2 user A's merge, #3 user C's compose).
Each requester only ever sees a position COUNT; the WORKER LOG must name which step and which
user it is processing.

Nothing about the compute changes — the worker still reuses `VideoGenerationService`. Only
the queue plumbing changed. Do the following, stopping to report if any step fails:

1. **Sync the code.** `git status` (expect a clean tree — CRLF noise is fine), then
   `git pull` the branch this repo tracks. Confirm the worker is the new version:
   `grep -n "renderTaskRepository.claimNext" scripts/render-worker.ts` should match, and
   `grep -n "claimNextQueuedRenderStep" scripts/render-worker.ts` should NOT. The claimed-step
   log line should include `step` and `user` fields (`grep -n '"claimed step"' scripts/render-worker.ts`).

2. **Dependencies.** No new deps are expected. If `./node_modules/.bin/tsx` is missing, run
   `npm ci`. Otherwise skip.

3. **Apply the migration to the shared database.** It is additive and idempotent
   (`CREATE TABLE / INDEX IF NOT EXISTS`), so it is safe to run even if the web deploy
   already applied it:
   `node scripts/apply-migration.js src/db/migrations/025_render_task_queue.sql`
   Then confirm the table exists (psql or the same script pattern): `render_tasks` with a
   partial unique index `uq_render_tasks_active_job`.

4. **Type-check the worker path only** (a full build is slow and unnecessary):
   `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — if that is too heavy, at minimum
   `./node_modules/.bin/tsx --eval "import('./scripts/render-worker.ts')"` must not throw an
   import/type error. Report any errors in `scripts/render-worker.ts`,
   `src/repositories/postgres/PostgresRenderTaskRepository.ts`, or
   `src/services/VideoGenerationService.ts`.

5. **Smoke test one claim cycle:** `npm run worker:once`. Expect a clean start line
   `[worker <host>#<pid>] ... starting {...}`, a heartbeat, one poll, and a clean exit when
   the line is empty (no stack traces). If a task IS queued, expect a
   `claimed step {"task":...,"step":...,"user":...}` line followed by `step done`.

6. **Restart the long-running service** so it picks up the new code:
   `launchctl kickstart -k gui/$(id -u)/com.rclipper.worker`
   (or unload+load the `com.rclipper.worker` LaunchAgent). Confirm it is alive:
   `launchctl print gui/$(id -u)/com.rclipper.worker | grep -i state`.

7. **Verify live behaviour.** Tail the worker log and confirm: (a) periodic heartbeats,
   (b) when a request reaches a heavy step, a `claimed step` line naming the step and the
   requesting user, (c) `step done` with a `seconds` timing. On the web `/admin/queue` page,
   the new "Render Worker Queue" panel should show the worker as **online** and list any
   active tasks.

Guardrails:
- Do NOT modify the compute methods or `VideoGenerationService` logic — only fix wiring/type
  issues if the type-check surfaces them.
- The database is the shared managed Postgres; the migration is additive and idempotent. Do
  NOT drop or alter the old `render_*` columns on `video_generation_jobs` — they are left in
  place intentionally for one release.
- Concurrency stays at `RENDER_CONCURRENCY` (default 1) so the Mac is never overloaded — do
  not raise it without asking.

Report back: the migration result, the smoke-test log, and confirmation the service is
running the new worker.

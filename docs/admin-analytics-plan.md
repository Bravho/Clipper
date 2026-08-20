# RClipper — Admin Analytics, Payments & Feedback Plan

**Status:** design only, no code written yet
**Date:** 2026-08-16
**Repo:** `D:\coding\clipper_agent` @ `d432d5f`

---

## 1. Context

The admin portal today is a thin operations view built for a staff/editor workflow that no
longer exists. Nine tabs sit in a horizontal scrolling strip; four of them read from Mock
in-memory repositories that reset on every server restart, and one is a "Not built yet"
placeholder. Meanwhile the product has grown a full self-serve pipeline (requester submits →
AI steps → requester approves at gates → download → optional transfer to Channel Management →
publish), and there is **no way for an admin to see how many people are actually getting
through it, what they pay, how long they wait, or what they complain about**.

This plan adds an admin-only analytics and administration layer with five goals:

1. A **conversion funnel** across the whole product — signup → login → generate → finish → pay →
   transfer/upload to Management → pay for Management → publish.
2. A **pipeline timing view** — how long a request waits in queue before each step is picked up,
   and how long each step takes to run.
3. An **approval-behaviour view** — when (time of day, day of week) and how often requesters click
   "approve / proceed", which is the arrival-rate input for server CPU sizing.
4. A **payment summary** for both revenue lines (video generation and Channel Management).
5. A **feedback triage page** for the questionnaire at the last pipeline step, with
   *Accept for review* → *Mark solved* status buttons.

Two of these cannot be answered from data that exists today, so the plan includes the
instrumentation to start collecting it (decided with Joe on 2026-08-16):

- **No login tracking exists at all.** NextAuth is JWT-only (`session.strategy = "jwt"`, no
  adapter, no `sessions` table); `grep last_login` returns nothing. → new `user_login_events` table.
- **Express-lane auto-approvals are indistinguishable from human clicks.** `_autoAdvanceIfEnabled()`
  deliberately reuses an existing approver id so `*_approved_by` is never blanked, and it writes
  identical `video_generation_step_history` rows. → new `pipeline_gate_events` table.

Both are forward-looking: metrics start from deploy day. Everything else in this plan is
computable retroactively from data already in Postgres.

---

## 2. What already exists (reuse, do not rebuild)

| Need | Already there |
|---|---|
| Admin route gating | `src/middleware.ts` matcher `/admin/:path*` + `admin/layout.tsx` → `requireRole(Role.Admin)`. New pages are gated automatically. |
| Mobile hamburger | `PortalNav` registry (`src/components/layout/PortalNav.tsx`) — a shell registers links, `Navbar` → `MobileNavDrawer` renders them. **Nothing new is needed for mobile.** |
| Desktop sidebar pattern | `src/components/layout/DashboardShell.tsx` — `<aside className="hidden w-56 … lg:flex lg:flex-col">` with glyph icons, active state, and a server-decided prop (`showManagement`) for conditional items. Copy this shape for admin. |
| Raw SQL for aggregates | `src/lib/db.ts` exports a shared `pg.Pool`; 28 files already call `pool.query(sql, params)` directly, including six non-repository services. This is the established pattern for analytics queries. |
| Step timing source | `video_generation_step_history (job_id, request_id, step, scene_index, created_at)` — append-only, written on every `currentStep` change from the single choke point `PostgresVideoGenerationJobRepository.update()`. |
| Render timing source | `render_tasks` — `enqueued_at`, `claimed_at`, `started_at`, `finished_at`, `duration_ms`, `attempts`, `claimed_by`. The best-instrumented table in the DB. |
| Feedback storage | `ai_content_reports` — already has `report_type ('feedback'\|'safety')`, `rating 1-5`, `reason`, `details`, `status ('open'\|'reviewing'\|'resolved'\|'dismissed')`, `created_at`, `resolved_at`. **Write-only today** — one INSERT, zero reads, no repository, no UI. |
| Money tables | `payment_intents.amount_baht` (Stripe, real THB), `credit_purchase_logs.amount_baht`, `clip_requests.price_baht / amount_paid_baht`, `credit_transactions` (credits ledger), `management_purchases.amount_credits`, `mobile_store_purchases.credits_granted`. |
| Admin page skeleton | `src/app/(auth)/admin/credits/page.tsx` — async server component, `requireRole`, `Promise.all` on a service singleton, stat-card grid + table with a fixed Tailwind class vocabulary. |

### Known data caveats that shape the queries

- `clip_requests.id` and `uploaded_assets.id` are **uuid in Joe's live DB but TEXT in the DDL** —
  migrations 006 and 019 both inspect `information_schema` for this. New tables must use `TEXT`
  for request/job ids with **no FK**, exactly like `render_tasks` does.
- `clip_requests.user_id` is TEXT with no FK to `users.id` — joins are unenforced; cast explicitly.
- `pg` returns `COUNT(*)` and `NUMERIC` as strings — every aggregate needs `::int` / `parseFloat`.
- Soft deletes everywhere: `users.deleted_at`, `management_content_items.removed_at`,
  `clip_requests.status = 'auto_cancelled'`. Every count needs an explicit filter decision
  (this plan: exclude soft-deleted users from population counts, keep their historical events).
- `render_tasks.enqueue()` uses `ON CONFLICT … DO UPDATE` which **resets `enqueued_at` and
  `duration_ms`** — a retried step overwrites its own prior attempt. Timing stats therefore
  describe the *last* attempt of each step, not every attempt. Noted on the page, not fixed here.
- When the Mac worker is offline, `_dispatchHeavy()` falls back to running **inline on the web
  server and writes no `render_tasks` row at all**. Those executions are invisible to queue
  analytics — the plan surfaces this as an explicit "inline fallback runs" counter derived from
  step history rows that have no matching render task.
- `TIMESTAMPTZ` is stored UTC. All time-of-day bucketing must use `AT TIME ZONE 'Asia/Bangkok'`.

---

## 3. Part A — Admin navigation rework

**Decision:** convert the admin shell from a horizontal tab strip to a **grouped left sidebar on
desktop**, keep the mobile hamburger, and **remove the dead menus**.

### A1. Remove these menu items and their pages

| Item | Why it goes |
|---|---|
| **Production Review** | Reads `productionReviewRepository` — a Mock in-memory repo with no table. The `ScheduledForPublishing` status it gates on is set only in seed data. |
| **Delivery** | Reads `publishingLinkRepository` — Mock, and the `publishing_links` table is never written by the app. |
| **Workload** | 525 lines of per-staff capacity maths against `editorProfileRepository` (Mock). The `Editor` role no longer exists — `Role` is `{ Requester, Admin }`. |
| **SLA** | Built on `ScheduledForPublishing` dwell time — a status the current pipeline never reaches. |
| **External Workforce (placeholder)** | Pure "Not Built Yet" page. |

Also delete the now-orphaned `AdminWorkflowService` API routes (`approve`/`return`/`hold`/`reject`
under `src/app/api/admin/requests/[id]/`) — all four `requireStatus(ScheduledForPublishing)` and
are therefore unreachable. Keep `deliver`. Keep `AdminStatusBadge`; drop `ProductionReviewBadge`.

> If Joe wants any of these kept as a stub instead of deleted, that is a one-line change to the
> nav array — flag it before implementation.

### A2. New grouped sidebar

`src/components/layout/AdminNav.tsx` is rewritten as `AdminShell.tsx` (mirroring
`DashboardShell.tsx`), exporting a grouped structure:

```
OPERATIONS
  ▣  Dashboard              /admin
  ◫  Requests               /admin/requests
  ⧗  Render Queue           /admin/queue
  ◉  Users                  /admin/users

ANALYTICS
  ◈  Conversion Funnel      /admin/analytics/funnel
  ⌛  Pipeline Timing        /admin/analytics/pipeline
  ⊞  Approval Activity      /admin/analytics/approvals
  ⚙  Capacity & CPU         /admin/analytics/capacity

MONEY
  ฿  Payments               /admin/payments
  ▤  Credits                /admin/credits

SUPPORT
  ✉  Feedback & Reports     /admin/feedback
```

Mechanics:

- `PortalNavSection` already supports `{ id, title, links[] }` and the drawer already renders
  `section.title` as a heading — so **registering four sections instead of one gives the mobile
  hamburger the same grouping for free**. `useRegisterPortalNav` is called once per group.
- Desktop: `<aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">`
  with the red "Admin Portal" label at the top, group headings in
  `text-xs font-semibold uppercase tracking-wider text-slate-400`, and the existing active-state
  rule (`pathname === href || pathname.startsWith(href + "/")`). Red accent for admin
  (`bg-red-50 text-red-800` active) to distinguish it from the requester's blue sidebar.
- Breakpoint: sidebar at `lg+`, hamburger below `lg` — matches `Navbar`'s existing `lg:hidden`
  toggle. (Today's admin strip breaks at `md`, which leaves 768–1023px with no nav at all.)
- `PortalNavLink.icon` already exists and the drawer already renders it; the sidebar renders it too.
- Labels stay hardcoded English — the whole admin surface is English and `messages.ts` has zero
  `admin.*` keys. Adding an `admin.nav.*` namespace would require entries in all three locales.
- Add the sub-routes to `src/config/routes.ts` (`ADMIN_ANALYTICS_FUNNEL`, `ADMIN_PAYMENTS`, …)
  rather than hardcoding strings in two places.
- `src/app/(auth)/admin/page.tsx` has a **duplicated** "Quick Links" array at lines 222–231 —
  replace it with an import of the same nav definition so the two cannot drift.

---

## 4. Part B — Database changes (migration 027)

One new migration file, `src/db/migrations/027_admin_analytics.sql`, **plus a standalone
copy-paste script** for Joe to run against the managed Postgres. It is idempotent
(`IF NOT EXISTS` throughout) and safe to run twice.

```sql
-- 027_admin_analytics.sql
-- Admin analytics instrumentation: login events, gate events, feedback triage,
-- and worker resource sampling. Idempotent.

BEGIN;

-- 1. Login events -----------------------------------------------------------
-- No login data exists today (NextAuth is JWT-only, no session table).
-- One row per successful sign-in. Never updated.
CREATE TABLE IF NOT EXISTS user_login_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,                 -- credentials | google | apple
                                             --   | google-native | apple-native
  surface     TEXT,                          -- web | android | ios | pwa | unknown
  is_new_user BOOLEAN NOT NULL DEFAULT FALSE,-- true on the sign-in that created the account
  ip_hash     TEXT,                          -- sha256(ip + salt); never store raw IP
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_events_user     ON user_login_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_created  ON user_login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_provider ON user_login_events (provider, created_at DESC);

-- 2. Pipeline gate events ---------------------------------------------------
-- One row per gate OPENING, closed in place when the gate is resolved.
-- job_id / request_id are TEXT with no FK: id column types vary uuid/text
-- across environments (see migrations 006 and 019). Same rule as render_tasks.
CREATE TABLE IF NOT EXISTS pipeline_gate_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  step           TEXT NOT NULL,              -- the awaiting_* VideoGenerationStep
  scene_index    INTEGER,                    -- per-scene gates only
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at    TIMESTAMPTZ,                -- push actually sent (NULL = suppressed/failed)
  resolved_at    TIMESTAMPTZ,
  resolution     TEXT,                       -- approved | revised | reopened | abandoned
  resolved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_source   TEXT,                       -- human | auto | system
  click_count    INTEGER NOT NULL DEFAULT 0, -- interactions before resolution
  wait_seconds   INTEGER,                    -- resolved_at - opened_at, stored on close
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- At most one open gate per (job, step, scene).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_events_open
  ON pipeline_gate_events (job_id, step, COALESCE(scene_index, -1))
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gate_events_step     ON pipeline_gate_events (step, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_events_resolved ON pipeline_gate_events (resolved_at DESC)
  WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gate_events_request  ON pipeline_gate_events (request_id);

-- 3. Feedback triage columns ------------------------------------------------
-- ai_content_reports already has status + resolved_at but nothing ever writes them.
ALTER TABLE ai_content_reports ADD COLUMN IF NOT EXISTS reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ai_content_reports ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ;
ALTER TABLE ai_content_reports ADD COLUMN IF NOT EXISTS resolution_note   TEXT;
ALTER TABLE ai_content_reports ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_ai_reports_status_created ON ai_content_reports (status, created_at DESC);

-- 4. Worker resource samples (for CPU sizing) -------------------------------
-- render_worker_heartbeat keeps only one last_seen_at per worker, so there is no
-- history of load. The worker's existing 10s heartbeat writes one sample per minute.
CREATE TABLE IF NOT EXISTS render_worker_samples (
  id             BIGSERIAL PRIMARY KEY,
  worker_id      TEXT NOT NULL,
  sampled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cpu_percent    REAL,      -- process CPU across all cores
  load_avg_1m    REAL,      -- os.loadavg()[0]
  cpu_count      INTEGER,
  mem_used_mb    INTEGER,
  mem_total_mb   INTEGER,
  active_tasks   INTEGER,   -- tasks this worker holds right now
  queue_depth    INTEGER    -- render_tasks in state queued/claimed platform-wide
);
CREATE INDEX IF NOT EXISTS idx_worker_samples_time ON render_worker_samples (sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_samples_wid  ON render_worker_samples (worker_id, sampled_at DESC);

COMMIT;
```

**Retention:** `render_worker_samples` grows ~1,440 rows/day/worker (~0.5M/year) — trivial, but
add a `DELETE FROM render_worker_samples WHERE sampled_at < NOW() - INTERVAL '180 days'` line to
the existing storage sweep cron. `user_login_events` and `pipeline_gate_events` are kept forever.

### Verify before running

Two objects this plan touches have **no DDL anywhere in the repo** (their migrations are missing
from the checkout — the 007/008 slots were taken by unrelated files): `payment_intents` and
`credit_purchase_logs`. Run `\d+ payment_intents` and `\d+ credit_purchase_logs` on the live DB
and confirm the column names below before the payments page is built:

```
payment_intents:       id, user_id, gateway, method, amount_baht, credits_to_add,
                       status, reference_no, gateway_ref, qr_payload,
                       expires_at, created_at, updated_at
credit_purchase_logs:  id, user_id, credits_added, amount_baht, transaction_ref, created_at
```

---

## 5. Part C — Instrumentation (the code that fills the new tables)

### C1. Login events

- `src/lib/auth/authOptions.ts` — in the NextAuth `signIn` callback (fires for every provider
  including the `google-native` / `apple-native` Credentials providers), fire-and-forget insert
  into `user_login_events`. Wrap in try/catch and swallow: **a logging failure must never block a
  sign-in.** Same defensive pattern as `_recordStepHistory()`.
- `is_new_user` comes from the existing account-creation branch; `surface` from a
  `x-rclipper-surface` header the Capacitor shell already can set, else parsed from user-agent.
- New service `src/services/analytics/LoginEventService.ts` (singleton, `pool.query` directly).
- Backfill note: `users.created_at` gives a synthetic "first login" for existing accounts so the
  historical signup curve is not empty on day one. Insert those with `provider = 'backfill'` and
  exclude them from login-frequency stats.

### C2. Gate events

Two insertion points, both already single choke points:

1. **Gate opens** — `PostgresVideoGenerationJobRepository.update()`, in the same block that writes
   `step_started_at` and calls `_recordStepHistory()`. If the new `currentStep` is an `awaiting_*`
   value, upsert an open `pipeline_gate_events` row. If the *previous* step was an `awaiting_*`
   value, close that row. This is where `notified_at` is stamped too, from the existing
   `pushNotificationService.notifyPipelineStep()` result.
2. **Gate resolves with an actor** — the ~14 requester approve routes under
   `src/app/api/requests/[id]/*` already have `session.user.id`. The actor is *not* currently
   threaded down to the repository, so add an optional `actor?: { userId: string; source: 'human' | 'auto' | 'system' }`
   parameter to `videoGenerationJobRepository.update()` and pass it from
   `VideoGenerationService` methods that take a `requesterId`. `_autoAdvanceIfEnabled()` passes
   `source: 'auto'`; the worker's `afterRenderStepCompleted()` passes `'system'`.

`click_count` is incremented by a lightweight `POST /api/requests/[id]/gate-interaction` beacon
fired by the panel components when the requester expands/reviews/re-plays before deciding —
optional, and can be deferred to a second pass if it feels like too much surface area.

### C3. Worker samples

`scripts/render-worker.ts` already runs `heartbeatTick()` every 10s. Add a counter so every 6th
tick also inserts a `render_worker_samples` row using `process.cpuUsage()`, `os.loadavg()`,
`os.totalmem()/freemem()`, in-flight task count, and one `SELECT count(*) FROM render_tasks
WHERE state IN ('queued','claimed')`. Cost is one small insert per minute.

---

## 6. Part D — The admin pages

All five follow the existing skeleton: async server component → `requireRole(Role.Admin)` →
`Promise.all` on a service singleton → stat-card grid + table/chart. New services live in
`src/services/admin/` next to the existing four. Every page accepts `?from=&to=` search params
(default: last 30 days) — today no admin page reads `searchParams`, so a small shared
`parseDateRange()` helper in `src/features/admin/` is worth adding once.

Charts use **Recharts** (`npm i recharts`), wrapped in thin `"use client"` components under
`src/features/admin/charts/` that take already-aggregated arrays as props — all aggregation stays
server-side in SQL.

### D1. `/admin/analytics/funnel` — Conversion Funnel

The eight stages requested, each as a stat card with count, % of previous stage, and % of all
users; plus a horizontal funnel bar chart and a per-day trend line.

| # | Stage | Query source |
|---|---|---|
| 1 | Signed up | `users` where `deleted_at IS NULL`, by `created_at` |
| 2 | Logged in | `COUNT(DISTINCT user_id)` from `user_login_events` *(new)* |
| 3 | Started generating a video | `COUNT(DISTINCT cr.user_id)` from `clip_requests cr` joined to `video_generation_jobs` — i.e. a job actually exists, not just a draft request |
| 4 | Reached the final step | jobs whose `video_generation_step_history` contains `awaiting_distribution_review` or `complete` |
| 5 | Paid for video generation | `clip_requests` where `download_unlocked = true AND is_trial_request = false`, cross-checked against `credit_transactions.type='request_charge'` and `payment_intents.status='paid'` |
| 6 | Moved a video to Channel Management | `management_content_items` where `source_type='rclipper_generation'` and `transferred_at IS NOT NULL` |
| 7 | Uploaded own video to Channel Management | `management_content_items` where `source_type='user_upload'` |
| 8 | Paid for Channel Management | `management_purchases` where `status='paid'` |
| 9 | Published through Channel Management | `management_publication_targets` where `status='published'` |

Each stage is counted as **distinct users** (the question asked "how many users"), with a
secondary "events" number in small text (e.g. 340 users / 1,207 videos). A second tab of the same
page shows the same funnel as **cohorts by signup week**, which is what actually reveals whether
onboarding is improving.

Drop-off callouts: the biggest absolute loss between two adjacent stages is highlighted, since
that is the one worth acting on.

### D2. `/admin/analytics/pipeline` — Queue Wait & Step Duration

Answers *"how long does a user wait before each step gets processed, and how long does it take"*.

**Per render step** (from `render_tasks`, grouped by `step`):

- queue wait = `claimed_at - enqueued_at` → count, mean, median, p90, max
- run time = `duration_ms` → mean, median, p90, max
- total = enqueue → finish
- retry rate = `AVG(attempts)`, failure rate = `state='failed'` share

Percentiles via `percentile_cont(0.5|0.9) WITHIN GROUP (ORDER BY …)`. Presented as a table plus a
grouped bar chart (wait vs run, stacked) so it is obvious at a glance whether a step is slow
because the worker is busy or because the step itself is expensive.

**Per pipeline step incl. AI steps** (from `video_generation_step_history`):

```sql
SELECT step,
       LEAD(created_at) OVER (PARTITION BY job_id ORDER BY created_at) - created_at AS duration
FROM video_generation_step_history
```
De-duplicate consecutive identical `step` values (the repo's guard is
`currentStep !== undefined`, not "value changed", so repeats are possible). This is the only way
to time `analyzing_content`, `generating_voice` and `generating_scene_design`, which run inline
on the web server and never touch the queue.

**Also on this page:**

- Live queue depth + oldest waiting task + worker online/offline (reuse
  `AdminDashboardService.getRenderQueueSnapshot()`).
- **Inline fallback counter** — step-history rows for render steps with no matching `render_tasks`
  row. These ran on the droplet because the Mac was offline; they are invisible to the timing
  stats above and they load the web server instead. Worth watching.
- Stall watch: jobs whose `step_started_at` exceeds `PROCESSING_STEP_TIMEOUT_SECONDS`
  (`src/config/stallThresholds.ts` — compose is the long pole at 25 min / ~16 min observed).

### D3. `/admin/analytics/approvals` — Approval Activity

Answers *"what time and how many times do users click to approve or request the next step"*.

- **Time-of-day × day-of-week heatmap** of gate resolutions, bucketed hourly in
  `Asia/Bangkok`. This is the arrival-rate profile that drives CPU sizing — a 7×24 grid of
  approvals, so the daily peak hour is unmistakable.
- **Clicks per job** — mean/median gate resolutions per completed job, split by express-lane
  (`auto_approve_remaining`) vs manual. Manual jobs pass through ~8 gates; express-lane jobs
  through ~3 human clicks and the rest automatic.
- **Human vs auto split** per gate, from `pipeline_gate_events.actor_source` *(new)* — the metric
  that is impossible today.
- **Gate dwell time** — `resolved_at - opened_at` per gate: mean, median, p90. Shows which gate
  users stall at (the plan's guess: `awaiting_scene_design_approval`, the first big decision).
- **Notification effectiveness** — dwell time when `notified_at IS NOT NULL` vs NULL. Tells you
  whether push actually shortens the wait, which directly reduces how long a job holds resources.
- **Abandonment** — gates open longer than 72h with no resolution, by step.

Until `pipeline_gate_events` accumulates data, the page falls back to the step-history
derivation and labels the numbers "estimated (pre-instrumentation)".

### D4. `/admin/analytics/capacity` — Capacity & CPU

The CPU-sizing view. See §7 for the model itself. Contents:

- Peak-hour arrival rate λ (approvals/hour, from D3) × mean CPU-seconds per pipeline run
  (from `render_tasks.duration_ms` summed per job) = required service capacity.
- Worker utilisation ρ over time from `render_worker_samples` *(new)*, with the queue-wait curve
  overlaid — the point where wait time starts climbing steeply is the real capacity ceiling.
- "Headroom" readout: at current concurrency (`RENDER_CONCURRENCY`, default 1), how many
  videos/day can be served before p90 queue wait exceeds a target (default 15 min), and how that
  changes at concurrency 2, 3, 4 or with a second worker.
- Scenario slider: *"if we reach N videos/day, we need X workers"*.

### D5. `/admin/payments` — Payment Summary

Two revenue lines side by side, with a shared date range.

**Video generation**

- Revenue in THB: `SUM(payment_intents.amount_baht) WHERE status='paid'` (Stripe card/PromptPay)
  \+ `mobile_store_purchases` (⚠️ **stores no price** — only `credits_granted`; revenue must be
  imputed at 1 credit = ฿1 via `CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE`, and the page must say so).
- Credits spent on generation: `credit_transactions` where `type='request_charge'`,
  minus `request_refund`.
- Download unlocks: `clip_requests` where `download_unlocked = true`.
- Top-up funnel: `payment_intents` created → paid / expired / failed, with time-to-pay
  (`updated_at - created_at`; there is no dedicated `paid_at`).
- Breakdown by `gateway` (stripe / gbprimepay) and `method` (card / promptpay_qr / ios / android).

**Channel Management**

- `management_purchases` where `status='paid'`: `SUM(amount_credits)`, count, by `product_code`
  (single video 50 / 3-month 300 / 6-month 550 / 1-year 1000).
- Refunds via `refunded_at`, failures via `failure_reason`.
- Active access passes (`management_access_passes` where `status='active'` and
  `expires_at > NOW()`), upcoming expiries in the next 30 days.
- Upload-bundle burn: `total_allowance - remaining`, plus expired-with-remaining (paid-for but
  unused — a refund-risk and a product signal).

**Combined**

- Total revenue by day/week/month (area chart, two series).
- ARPU and paying-user count; repeat-purchase rate.
- Credit float: `SUM(credit_wallets.balance)` — an outstanding liability, worth watching.
- **CSV export** button (`/api/admin/payments/export`) — accounting will ask for it.

Money-vs-credits is stated explicitly on the page: `payment_intents.amount_baht` is the only
true cash figure; everything else is credits valued at ฿1.

### D6. `/admin/feedback` — Feedback & Reports

The triage page for `ai_content_reports`, which today is written and never read.

- Two tabs: **Feedback** (`report_type='feedback'`, has a 1–5 star `rating`) and
  **Safety Reports** (`report_type='safety'`) — the safety tab matters for store compliance.
- Filters: status, reason, rating, date range. Default view: `status='open'`, newest first.
- Row: rating stars · reason label · truncated `details` · user email · linked request
  (`/admin/requests/{id}`) · age · status pill.
- Summary strip: open / in-review / resolved counts, average rating, rating trend sparkline,
  and reason distribution (`video_quality`, `scene_selection`, `motion_direction`, `audio_music`,
  `subtitles`, `aspect_ratio`, `other_feedback`).
- **Two action buttons per row, exactly as requested:**
  - **"Accept for review"** → `POST /api/admin/feedback/[id]/review` → `status='reviewing'`,
    `review_started_at=NOW()`, `reviewed_by=<admin id>`. Row shows an **In Progress** pill.
  - **"Mark solved"** → `POST /api/admin/feedback/[id]/resolve` → `status='resolved'`,
    `resolved_at=NOW()`, optional `resolution_note`. Row shows a **Solved** pill.
  - Plus **"Dismiss"** (`status='dismissed'`) for spam/duplicates — the status already exists in
    the CHECK constraint and the page is incomplete without it.
- Client interaction copies `AdminActionButtons.tsx`: `useTransition` + `fetch` + `router.refresh()`.
- New pieces: `IAiContentReportRepository` + `PostgresAiContentReportRepository` (the table has no
  repository at all today), `AdminFeedbackService`, zod schemas in
  `src/features/admin/validation/`.

> **API auth note:** existing admin routes call the *page* helper `requireRole()`, which calls
> `redirect()` internally — inside a route handler that throws a Next redirect error swallowed by
> the catch, so unauthorised API calls return a confusing 400. Add a small
> `requireApiRole(Role.Admin)` helper in `src/lib/auth/helpers.ts` returning a proper 403 and use
> it for all new admin endpoints. (Retrofitting the old routes is optional.)

---

## 7. Part E — Server CPU requirement analysis

### The in-app model (what `/admin/analytics/capacity` computes)

The CPU consumer is not the web server — it is the Mac render worker running ffmpeg and Remotion.
`docs/storage-lifecycle-design.md` Addendum B records the empirical shape: an M4/16GB comfortably
runs **1–2 concurrent Remotion renders** (each spawns Chromium, 1–3 GB), render+encode is ~2–4
min/job, and transfer time (1–55s) is an order of magnitude smaller than compute. So the model is
a single-queue, c-server system:

```
λ  = peak-hour job arrival rate            ← from approval heatmap (D3)
S  = mean CPU-seconds per job              ← SUM(render_tasks.duration_ms) per job (D2)
c  = worker concurrency (RENDER_CONCURRENCY, default 1) × worker count
ρ  = λ·S / c                               ← utilisation; ρ ≥ 0.8 means queue waits explode
Wq ≈ Erlang-C(c, λ, S)                     ← expected queue wait
```

The page shows measured λ, S and ρ, then solves for the smallest `c` that keeps p90 `Wq` under a
configurable target. Because `render_tasks` already stores real per-step `duration_ms`, `S` is
measured rather than assumed — that is the model's main strength over a spreadsheet estimate.

### Other methods worth presenting alongside it

Joe asked for alternatives. In rough order of effort-to-value:

1. **Utilisation-vs-latency curve (empirical, no model).** Scatter every completed render task as
   (queue depth at enqueue time, actual wait). The knee of that curve is the honest capacity limit
   and requires no queueing-theory assumptions. Cheapest credible answer, and it uses data you
   already have.
2. **Little's Law sanity check.** `L = λ·W` — average number of jobs in the system equals arrival
   rate × time in system. Compute all three independently from `render_tasks` and check they
   agree; a mismatch means the timing data has gaps (usually inline-fallback runs).
3. **Load / soak test.** Enqueue N synthetic jobs at a controlled rate against a staging worker
   and record `duration_ms` degradation as concurrency climbs from 1→4. This is the only method
   that catches memory pressure and thermal throttling on the Mac Mini — which the analytical
   model cannot see. Worth doing once before any hardware purchase.
4. **OS-level time-series (Prometheus + Grafana, or Netdata).** `node_exporter` on the droplet and
   the Mac gives real CPU/RAM/IO at 15s granularity with alerting, without adding tables to the
   product DB. The right long-term home for infrastructure metrics; `render_worker_samples` in
   this plan is the lightweight in-app version for when you just want the number next to the
   business metrics.
5. **Per-invocation ffmpeg/Remotion profiling.** `src/lib/ai/ffmpegService.ts` already logs
   `[compose:{ratio}] ffmpeg done in X.Xs` to stdout. Persisting those lines gives per-ratio and
   per-filter cost attribution — which tells you whether to buy CPU or to cut a ratio / simplify a
   filter chain. Often the cheapest capacity win is not more hardware.
6. **Cost-per-video curve.** Divide monthly infrastructure cost by videos rendered and plot it
   against volume. Reframes "how much CPU" as "what does a video cost to make", which is the
   version of the question that belongs next to the payments page — and it makes the
   pricing decision (49cr download, 50cr Management unlock) auditable against unit cost.
7. **Scenario simulator.** A small Monte-Carlo over the measured arrival and service
   distributions, projecting p50/p90 wait at 2×, 5×, 10× current volume. Better than a point
   estimate because it shows the *variance* — the tail is what users actually complain about.

Recommendation: build (1) and the Erlang model into the capacity page now, run (3) once before
the next hardware decision, and stand up (4) separately when there is a second worker to watch.

---

## 8. Files touched

**New**

```
src/db/migrations/027_admin_analytics.sql
scripts/sql/027_admin_analytics_manual.sql        ← copy-paste script for Joe
src/components/layout/AdminShell.tsx              ← replaces AdminNav.tsx
src/config/adminNav.ts                            ← single source for sidebar + quick links
src/services/analytics/LoginEventService.ts
src/services/analytics/GateEventService.ts
src/services/admin/AdminFunnelService.ts
src/services/admin/AdminPipelineMetricsService.ts
src/services/admin/AdminPaymentsService.ts
src/services/admin/AdminFeedbackService.ts
src/repositories/interfaces/IAiContentReportRepository.ts
src/repositories/postgres/PostgresAiContentReportRepository.ts
src/app/(auth)/admin/analytics/{funnel,pipeline,approvals,capacity}/page.tsx
src/app/(auth)/admin/payments/page.tsx
src/app/(auth)/admin/feedback/page.tsx
src/app/api/admin/feedback/[id]/{review,resolve,dismiss}/route.ts
src/app/api/admin/payments/export/route.ts
src/features/admin/charts/*.tsx                   ← Recharts wrappers
src/features/admin/dateRange.ts
tests/services/admin/*.test.ts
```

**Modified**

```
src/app/(auth)/admin/layout.tsx                   ← sidebar layout
src/app/(auth)/admin/page.tsx                     ← quick links from shared config
src/config/routes.ts                              ← admin sub-route constants
src/lib/auth/helpers.ts                           ← requireApiRole()
src/lib/auth/authOptions.ts                       ← login event hook
src/repositories/postgres/PostgresVideoGenerationJobRepository.ts  ← gate events + actor param
src/repositories/index.ts                         ← register new repository
src/services/VideoGenerationService.ts            ← thread actor through approve paths
scripts/render-worker.ts                          ← resource sampling
package.json                                      ← recharts
```

**Deleted**

```
src/app/(auth)/admin/{production-review,delivery,workload,sla,external-workforce-placeholder}/
src/app/api/admin/requests/[id]/{approve,hold,reject,return}/route.ts
src/features/admin/components/ProductionReviewBadge.tsx
src/features/admin/components/AddEditorForm.tsx   ← already 0 bytes
```

Note the sandbox cannot unlink files on the mounted drive (see the `rclipper-management` memory —
two 410-stub folders are still owed a delete). Deletions will be listed for Joe to run locally.

---

## 9. Suggested build order

1. **Migration 027 + manual SQL script.** Joe runs it; nothing else depends on being deployed.
2. **Instrumentation** (login events, gate events, worker samples) — deploy early so data starts
   accumulating while the UI is being built.
3. **Nav rework + dead-page removal.** Self-contained, immediately visible, low risk.
4. **Feedback page.** Highest immediate value — there is unread user feedback sitting in the DB
   right now, and it needs no new data collection.
5. **Payments page.** All from existing tables; verify the two undocumented schemas first.
6. **Funnel page.** Stages 1–2 need login data; 3–9 are retroactive.
7. **Pipeline timing page.** Fully retroactive from `render_tasks` + step history.
8. **Approvals + Capacity pages.** Need `pipeline_gate_events` to have accumulated ~2 weeks of
   data to be meaningful.

---

## 10. Verification

- **Migration:** run 027 twice against a scratch DB — must be a no-op the second time. Confirm
  `\d user_login_events`, `\d pipeline_gate_events`, `\d ai_content_reports`.
- **Login events:** sign in on web (credentials + Google), Android native, and iOS native; assert
  one row per sign-in with the right `provider` and `surface`. Then break the insert deliberately
  (revoke table permission) and confirm **sign-in still succeeds**.
- **Gate events:** run one job end to end with express lane OFF and one with it ON; assert the
  manual job has `actor_source='human'` on every gate and the express job has `'auto'` after the
  scene-design gate. Assert the unique partial index prevents duplicate open rows on a
  reopen→re-approve loop.
- **Timing queries:** cross-check the page's p50 render duration against
  `SELECT step, percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FROM render_tasks
   WHERE state='done' GROUP BY step` run by hand in psql.
- **Funnel:** pick one known test user and verify they appear in exactly the stages they actually
  completed. Verify stage counts are monotonically non-increasing (a later stage counting more
  users than an earlier one means a join bug).
- **Payments:** reconcile the page's THB total against the Stripe dashboard for the same window;
  they must match to the satang. Reconcile credits granted against `credit_transactions`.
- **Feedback:** submit a real feedback entry through the last pipeline step, then Accept for
  review → confirm In Progress pill + `review_started_at`, then Mark solved → confirm
  `resolved_at` and `reviewed_by`. Confirm a non-admin session gets 403 (not a redirect) from the
  API routes.
- **Nav:** at 1440px the sidebar shows four groups; at 900px and 390px only the hamburger, with
  the same four group headings. Confirm a Requester hitting `/admin/analytics/funnel` is
  redirected to `/dashboard` by middleware.
- **Tests:** `npm test` — new service tests instantiate fresh Mock repos per the existing
  convention. Note `docs`/memory warn the sandbox mount is too slow for `tsc`/`jest`; run the
  toolchain locally or copy `src` to `/tmp` first.

---

## 11. Open items to confirm before implementation

1. **Deleting the five dead pages** — confirmed in principle; flag if any should stay as a stub.
2. **`payment_intents` / `credit_purchase_logs` schemas** — no DDL in the repo; verify against the
   live DB (§4).
3. **Mobile store revenue** — `mobile_store_purchases` records no price. Apple/Play revenue can
   only be imputed at ฿1/credit, or reconciled manually from store product IDs. Acceptable?
4. **`click_count` beacon** (C2) — extra surface area for a nice-to-have metric. Include in v1 or
   defer?
5. **Feedback tabs** — should the safety-report tab live on the same page as product feedback, or
   as its own compliance page?

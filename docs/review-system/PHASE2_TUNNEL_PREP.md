# Phase 2 LINE Webhook — cloudflared Quick-Tunnel & Safe DB Env Proposal

**LINE webhook route:** `POST /api/line/webhook`  
**Route file:** `src/app/api/line/webhook/route.ts`

---

## 1. Running the LINE Webhook on Mar-PC Behind a cloudflared Quick-Tunnel

### Prerequisites
- Node.js running on Mar-PC (the Next.js dev/start server, port 3000 unless changed)
- `cloudflared` installed (download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ — no Cloudflare account needed for a quick tunnel)

### Start the tunnel (one command)

```sh
cloudflared tunnel --url http://localhost:3000
```

Cloudflare assigns a random public URL like:

```
https://abc123def456.trycloudflare.com
```

The terminal output line "Your quick Tunnel has been created!" shows the full URL.

### Register the webhook in LINE OA Manager

1. Open [LINE Official Account Manager](https://manager.line.biz/) → your OA → **Settings → Messaging API**.
2. In the **Webhook URL** field, enter:
   ```
   https://<random>.trycloudflare.com/api/line/webhook
   ```
3. Click **Verify**. LINE sends a POST with an empty `events` array.
   - The server returns **HTTP 200** (the webhook handles the empty array silently).
   - If you see **HTTP 401**, HMAC signature verification failed — check `LINE_CHANNEL_SECRET` in `.env.local`.
4. Enable the **Use webhook** toggle.

### Enable LINE OA Chat alongside the webhook

In LINE OA Manager → **Settings → Chat** → **Chat** must be **ON** (for Tho's human-takeover use).
The `takeoverActive` flag controls whether the webhook sends auto replies or yields to the human operator.

---

## 2. Required Environment Variables (Mar-PC `.env.local`)

All flags below must be set on the Mar-PC test server only; **never set them on the production server** (`/root/rc2` or any live app instance).

```sh
# === LINE OA ===
LINE_CHANNEL_SECRET=<your LINE OA Messaging API channel secret>
LINE_CHANNEL_ACCESS_TOKEN=<your LINE OA channel access token>
LINE_CHANNEL_ID=<your LINE OA channel ID (numeric)>

# === Review / LINE Intake master switches ===
REVIEW_SYSTEM_ENABLED=true
LINE_INTAKE_ENABLED=true
RENDER_LANE_ENABLED=true

# === Render lane routing ===
RENDER_LANE=backup           # or 'operator_pc' (alias)

# === Storyboard precheck (optional) ===
STORYBOARD_AI_PRECHECK_ENABLED=false    # enable when ready

# === Stripe (TEST mode only — NEVER use live keys here) ===
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_ALLOW_LIVE=false
STRIPE_PAYMENT_LINK_TRIAL=https://buy.stripe.com/test/xxx
STRIPE_PAYMENT_LINK_STARTER=https://buy.stripe.com/test/xxx
STRIPE_PAYMENT_LINK_GROWTH=https://buy.stripe.com/test/xxx
STRIPE_PAYMENT_LINK_PRO=https://buy.stripe.com/test/xxx

# === Review admin / Grok Bot ===
REVIEW_PREVIEW_JWT_SECRET=<openssl rand -base64 32>
REVIEW_PUBLIC_ORIGIN=https://<random>.trycloudflare.com
REVIEW_ADMIN_TOKEN=<openssl rand -base64 32>
GROKBOT_REVIEW_WEBHOOK_URL=<Grok Bot webhook endpoint, if used>
GROKBOT_REVIEW_WEBHOOK_KEY=<shared HMAC key>

# === LINE test mode — tags all new records with is_test=true ===
LINE_TEST_MODE=true          # OR set LINE_TEST_SHOP_ID=<lineUserId of the test shop>
LINE_TEST_SHOP_ID=            # Optional: single test shop LINE user ID

# === Gemini (for AI pipeline) ===
GEMINI_API_KEY=<your Gemini key>

# === Database ===
PGHOST=...
PGDATABASE=...
# (other PG vars as on prod)

# === Spaces ===
DO_SPACES_KEY=...
DO_SPACES_SECRET=...
DO_SPACES_ENDPOINT=...
DO_SPACES_BUCKET=...
DO_SPACES_REGION=...
```

> **Security note:** Never commit `.env.local` to git. Never print its contents in logs.
> Run `node scripts/check-line-test-env.cjs` before starting the server to verify required flags.

---

## 3. Owner Decision: Live Prod DB for Phase 2 LINE Test

Tho chose to run the Phase 2 LINE test directly against the live production database.
The conditions below must be met to keep test data isolated and non-destructive.

### 3a. Migration Apply Order

Apply all migrations in **exactly this order** before starting the Phase 2 test server. Tho applies them manually; the application never auto-applies migrations.

| # | File | Purpose |
|---|------|---------|
| 048 | `048_review_core.sql` | Review items, actions, outbox, escalation rules |
| 049 | `049_line_intake.sql` | line_accounts, conversation states, intake channel on clip_requests |
| 050 | `050_service_packages.sql` | service_packages, package_orders, package_usage |
| 051 | `051_line_webhook_events.sql` | line_webhook_events deduplication table |
| 052 | `052_line_runtime.sql` | Render lane columns, LINE runtime fields |
| 053 | `053_review_reminder_takeover.sql` | reminder_sent_at on review_items; takeover columns on line_accounts |
| 054 | `054_is_test_flag.sql` | **is_test boolean on line_accounts, package_orders, clip_requests** |

Migration 054 is **required** for the is_test tagging to work. The `ADD COLUMN IF NOT EXISTS` clauses are idempotent.

### 3b. Test Data Tagging

All records created during the LINE test run will have `is_test = true` on:
- `line_accounts` (the test shop's LINE account)
- `package_orders` (test packages purchased)
- `clip_requests` (test clip jobs submitted via LINE)

How to enable: set **`LINE_TEST_MODE=true`** in `.env.local` on Mar-PC before starting the server.
Alternatively, set `LINE_TEST_SHOP_ID=<lineUserId>` to tag only that specific LINE user.

**To identify test data later:**
```sql
SELECT * FROM clip_requests WHERE is_test = true ORDER BY created_at DESC;
SELECT * FROM package_orders WHERE is_test = true ORDER BY created_at DESC;
SELECT * FROM line_accounts WHERE is_test = true;
```

### 3c. Feature Flags — Mar-PC Test Only

Turn these ON in Mar-PC's `.env.local`. They must stay **OFF** on the production server:

| Flag | Value | Purpose |
|------|-------|---------|
| `REVIEW_SYSTEM_ENABLED` | `true` | Enables review gates |
| `LINE_INTAKE_ENABLED` | `true` | Enables LINE OA webhook flow |
| `RENDER_LANE_ENABLED` | `true` | Enables render lane routing |
| `STRIPE_ALLOW_LIVE` | `false` | Keeps Stripe in test mode |
| `LINE_TEST_MODE` | `true` | Tags all created records as test data |
| `STORYBOARD_AI_PRECHECK_ENABLED` | `false` (start) | Enable when testing precheck |

Production server (`/root/rc2`): all of the above remain at their defaults (off/false).

### 3d. Stripe — Test Mode Only

- `STRIPE_SECRET_KEY` must begin with `sk_test_` — the preflight script verifies this.
- `STRIPE_ALLOW_LIVE=false` — the webhook route rejects live Stripe events when this is false.
- Payment Links in `.env.local` must be Stripe test Payment Links (`buy.stripe.com/test/...`).

### 3e. Live database mutation audit (Round 5 — is_test job isolation)

The LINE flow is **not append-only**. It inserts into existing tables and updates rows that can predate the current test session. A live database is not isolated by feature flags or render lanes. The audit below lists SQL mutation sites reachable through intake, review and rendering, including shared worker bookkeeping. It does not authorize running any of them during offline verification.

#### Guarantees added in this revision

**render_tasks — old Mac Mini invisibility via test state values (strongest guarantee)**

The old Mac Mini worker (deployed before this branch) claims `render_tasks` with:
```sql
WHERE device_only = FALSE AND (state = 'queued' OR (state = 'claimed' AND ...stale...))
```
It never sees `state = 'test_queued'` or `state = 'test_claimed'`.

When `LINE_TEST_MODE=true`, `PostgresRenderTaskRepository.enqueue()` inserts with `state = 'test_queued'` (not `'queued'`). The `claimNext()` in test mode only claims `test_queued`/`test_claimed` tasks; in non-test mode it only claims `queued`/`claimed` tasks. The `release()` / `releaseClaim()` operations use a SQL `CASE` to restore to the correct namespace (`test_claimed → test_queued`; `claimed → queued`). The stale-reclaim path is protected by the same state filter: the old Mac Mini's stale-reclaim only promotes `state = 'claimed'` rows — `test_claimed` is invisible.

**Requires migration 057** (`src/db/migrations/057_test_job_isolation.sql`) to be applied before any test render jobs are enqueued. Migration 057 adds `uq_render_tasks_active_test_job` (prevents double-queueing the same test job) and `idx_render_tasks_test_active` (index for the test-worker claim scan). Apply after 054 and 049.

**enqueue DO NOTHING — no more reset of active tasks**

`PostgresRenderTaskRepository.enqueue()` (all paths, all modes) uses `ON CONFLICT ... DO NOTHING` (replacing the previous `DO UPDATE SET state='queued', attempts=0 ...`). If a task is already `queued` or `claimed`, `enqueue()` returns the existing row unchanged rather than resetting it. Callers that relied on the reset for retries are safe: a re-enqueue only happens after a step fails (state `failed`), which is not in the conflict predicate, so a new row is inserted correctly. This change eliminates the risk of resetting a live render-task claim.

**video_generation_jobs — claimNextQueuedRenderStep JOIN guard**

`PostgresVideoGenerationJobRepository.claimNextQueuedRenderStep()` now joins `clip_requests` and filters by `cr.is_test` based on `LINE_TEST_MODE`. Note: the old Mac Mini worker does NOT call this method (it uses the `render_tasks` queue). The JOIN guard protects any NEW code calling this path; `is_test` state-value isolation is not needed here.

**asset_visual_analyses — claim JOIN guard**

`PostgresAssetVisualAnalysisRepository.claim()` now joins `uploaded_assets → clip_requests` and filters by `cr.is_test`. Non-test worker skips assets from test requests; test worker claims only test-request assets. LEFT JOINs mean assets with no associated request (orphaned uploads) are treated as non-test. Requires migration 054 for `cr.is_test`.

**review_outbox — already guarded**

`PostgresReviewOutboxRepository.claimNext()` already had `LINE_TEST_MODE` filtering (EXISTS join on `clip_requests.is_test`). No change needed.

| SQL source | Tables | Mutation / isolation |
|---|---|---|
| `src/repositories/postgres/PostgresUserRepository.ts:41` | `users` | INSERT; test emails use a separate `:test` hash namespace. |
| `src/repositories/postgres/PostgresLineAccountRepository.ts:49,66,73,104,107` | `line_accounts / line_conversation_states` | INSERT and UPDATE. Account reuse blocked if `LINE_TEST_MODE=true` and `is_test=false`. Conversations lack `is_test`; use a distinct test channel. |
| `src/repositories/postgres/PostgresServicePackageRepository.ts:97,162,188,225` | `package_orders / package_usage / clip_requests` | INSERT/UPDATE. Active-order lookup is test-filtered; consumption matched to order `is_test`. |
| `src/repositories/postgres/PostgresClipRequestRepository.ts:283,315,367,400,475` | `clip_requests` | INSERT and UPDATE metadata/status. Adapters target request IDs; no universal test-only UPDATE guard (writes are scoped to the test request). |
| `src/repositories/postgres/PostgresUploadedAssetRepository.ts:83,153` | `uploaded_assets` | INSERT intake/AI/render outputs; UPDATE metadata. Scoped by request or asset ID. |
| `src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:266,387,541,573,575,608,623,632` | `video_generation_jobs / step_history / heartbeat` | INSERT job/history/heartbeat; UPDATE pipeline state and claims. `claimNextQueuedRenderStep` is now guarded by `cr.is_test` JOIN filter. Other `update()` calls are scoped by job ID (owned by the test request). |
| `src/repositories/postgres/PostgresRenderTaskRepository.ts` | `render_tasks` | **GUARDED.** Test jobs enqueued as `test_queued`; claimed as `test_claimed`. Old Mac Mini worker cannot see or reclaim test tasks. `enqueue()` is now DO NOTHING (never resets active tasks). |
| `src/repositories/postgres/PostgresAssetVisualAnalysisRepository.ts` | `asset_visual_analyses` | **GUARDED.** `claim()` joins to `clip_requests.is_test`; non-test worker skips test assets. Requires migration 054. |
| `src/repositories/postgres/PostgresReviewItemRepository.ts:72,204,251` | `review_items` | INSERT gate/escalation; UPDATE decision and reminder bookkeeping. Reminder job and admin list are not globally test-filtered. |
| `src/repositories/postgres/PostgresReviewActionRepository.ts:35` | `review_actions` | INSERT immutable decision/action audit. |
| `src/repositories/postgres/PostgresReviewOutboxRepository.ts:41,45,60,83,90,101` | `review_outbox` | **ALREADY GUARDED.** `claimNext()` only processes test events in `LINE_TEST_MODE=true`. |
| `src/app/api/line/webhook/route.ts:43,169,172` | `line_webhook_events` | INSERT or conflict UPDATE lease; UPDATE completed/failure. No `is_test` column; use a distinct test channel. |
| `scripts/render-worker.ts:159` | `render_worker_samples` | INSERT telemetry. Worker uses the guarded `renderTaskRepository.claimNext()` and `reviewOutboxRepository.claimNext()`. |

#### Old Mac Mini worker — residual risk assessment

The old deployed Mac Mini worker's claim paths:
- `render_tasks`: `WHERE device_only = FALSE AND (state = 'queued' OR (state = 'claimed' AND ...stale...))` — **SAFE.** Test jobs use `test_queued`/`test_claimed`; invisible by construction.
- `video_generation_jobs.claimNextQueuedRenderStep`: **NOT CALLED** by the old worker (it uses the `render_tasks` queue). No risk.
- `asset_visual_analyses.claim()`: the visual analysis worker code was introduced in the same branch as this guard. If the old deployed Mac Mini doesn't have the visual analysis worker code at all, no claim is made. If it does, the guard was not present in the old code — but the old Mac Mini claiming test visual analyses only writes to `asset_visual_analyses` (no production data mutation) and is harmless; the test worker would then find the analysis already done.
- `render_worker_heartbeat`, `render_worker_samples`: shared telemetry tables, no production data risk.

#### Management jobs — unguarded (acceptable)

`management_jobs` does not have `is_test` and is not directly linked to `clip_requests` at the claim level. The management worker reconciles publications. If a test publication creates a management job, the management worker would process it — this could trigger social-publishing API calls for the test publication. **Mitigation:** keep `STRIPE_ALLOW_LIVE=false` and avoid setting up social publishing credentials on Mar-PC. Management jobs from the test run would simply fail to reconcile (no credentials), which is acceptable.

#### Migration apply order (updated)

Apply migrations **in this exact order** before the Phase 2 test run:

| # | File | Purpose |
|---|------|---------|
| 048 | `048_review_core.sql` | Review items, actions, outbox, escalation rules |
| 049 | `049_line_intake.sql` | line_accounts, conversation states, render lane |
| 050 | `050_service_packages.sql` | service_packages, package_orders, package_usage |
| 051 | `051_line_webhook_events.sql` | line_webhook_events deduplication |
| 052 | `052_line_runtime.sql` | Render lane columns, LINE runtime fields |
| 053 | `053_review_reminder_takeover.sql` | Reminder and takeover columns |
| 054 | `054_is_test_flag.sql` | **is_test boolean on line_accounts, package_orders, clip_requests** |
| 055 | `055_asset_visual_analyses.sql` | asset_visual_analyses table |
| 056 | `056_storyboard_versions.sql` | Storyboard versioning |
| **057** | **`057_test_job_isolation.sql`** | **Unique index + scan index for test_queued/test_claimed states — REQUIRED before first test render job** |

**DELETE audit:** No SQL DELETE is invoked by the normal LINE intake/review/render progression. Shared adapters expose DELETE methods that are not called by that progression. The optional cleanup helper `src/services/line/cleanupLineAssets.ts:19` deletes storage objects (not DB rows) only with `execute=true`. Do not run cleanup for this audit.

**Remaining limits:** Conversation states (`line_conversation_states`) and webhook leases (`line_webhook_events`) lack `is_test` — use a distinct test LINE channel and test shop identity. Reminder selection and admin review APIs can see earlier/production reviews; do not run the reminder script or use an unfiltered admin list against the live DB as a test. `clip_requests` and `video_generation_jobs` adapter methods (update/status) are scoped by ID, not by `is_test` predicate — they will only touch rows the test flow created. Management jobs are unguarded (see above).

Only Mar-PC may enable these test flags; never enable them on production `/root/rc2`. Keep `STRIPE_ALLOW_LIVE=false`. Apply migrations 048–057 before starting the test server.

---

## 4. Storyboard Precheck Migrations (if used in Phase 2)

The storyboard precheck stores issues in `review_items.signals` (existing JSONB column on migration 048). No additional migration is required for the precheck feature itself.

If `STORYBOARD_AI_PRECHECK_ENABLED=true`, the precheck makes one Gemini Flash API call per storyboard gate. This uses the `GEMINI_API_KEY`. The estimated cost: ~852 input tokens + 1024 max output tokens per call.

---

## 5. Running the Preflight Check

Before starting the Mar-PC test server, run:

```sh
node scripts/check-line-test-env.cjs
```

This checks (without printing values):
- `STRIPE_ALLOW_LIVE` is `false`
- Stripe key starts with `sk_test_` (test key)
- `LINE_TEST_MODE=true` OR `LINE_TEST_SHOP_ID` is set
- `REVIEW_SYSTEM_ENABLED`, `LINE_INTAKE_ENABLED`, `RENDER_LANE_ENABLED` are `true`

---

## 6. Optional / Future: Safer Separate-DB Setup

**Why:** Using the live prod DB means a mis-wired UPDATE could affect real orders/users. A separate DB eliminates that risk entirely.

**Recommended approach (when ready):**

1. Create a **Neon branch** from the prod DB (point-in-time copy of schema + seed data).
2. Add a `.env.line-test` file (never committed):
   ```sh
   PGHOST=<neon-branch-host>
   PGDATABASE=<branch-db-name>
   # ... all PG vars pointing to the branch
   LINE_TEST_MODE=true
   STRIPE_ALLOW_LIVE=false
   ```
3. Add an npm script to load it:
   ```sh
   # package.json
   "dev:line-test": "dotenv -e .env.line-test -- next dev"
   ```
   Requires `dotenv-cli`: `npm i -D dotenv-cli`.
4. Create a dedicated **LINE Test OA Channel** (separate from production OA) so test messages never reach the prod webhook.
5. All real production traffic continues unaffected on the main `.env.local` → prod DB.

This approach adds a 10-minute setup cost and completely eliminates any risk of prod data contamination.

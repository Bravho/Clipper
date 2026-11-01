# Phase 2 LINE Webhook — cloudflared Quick-Tunnel & Safe DB Env Proposal

**LINE webhook route:** `POST /api/line/webhook`  
**Route file:** `src/app/api/line/webhook/route.ts`

---

## 1. Running the LINE Webhook on Mar-PC Behind a cloudflared Quick-Tunnel

### Prerequisites

**Not started; pending Tho's OK.** cloudflared is **not yet installed** on Mar-PC (neither PATH nor a winget package). After Tho approves installation:

```powershell
winget install --id Cloudflare.cloudflared
```

Tho must apply migrations 048–058 in order first, including **054–058**; none were applied during this preparation. Populate the environment described in section 2, including LINE credentials, DB/storage credentials, review secrets, `REVIEW_SYSTEM_ENABLED=true`, `LINE_INTAKE_ENABLED=true`, `RENDER_LANE_ENABLED=true`, `RENDER_LANE=backup`, `STRIPE_ALLOW_LIVE=false` and **`LINE_TEST_MODE=true`**. Existing real accounts are refused in global test mode. Keep `PAYMENT_DISABLED=false`; test shops already bypass payment.

### Exact start commands (only after Tho approves)

From `D:\coding\clipper_agent`, in the server PowerShell terminal:

```powershell
$env:LINE_TEST_MODE = 'true'
npm run dev -- --hostname 127.0.0.1 --port 3000
```

`package.json` maps `dev` to `next dev`. Development mode is appropriate for this webhook test and needs no production build; explicit port **3000** prevents silently choosing another port. Next loads `.env.local`; exported shell variables take precedence.

In a separate terminal, start the test render worker when rendering is needed:

```powershell
$env:LINE_TEST_MODE = 'true'
npm run worker
```

`worker` runs `tsx scripts/render-worker.ts`, whose bootstrap loads `.env.local`. With test mode enabled, the repository claims only test jobs (`test_queued` / `test_claimed`), leaving production jobs alone. This process can use paid providers: start it only when Tho authorizes the actual test.

Optional helper: export all required variables into the parent PowerShell environment (the read-only checker reads `process.env` only), then run `./scripts/phase2-start.ps1 -IConfirmThoApproved`. It refuses without the switch, exact `LINE_TEST_MODE=true`, cloudflared, passing preflight, or available port 3000. It opens separate server/tunnel windows; it does not apply migrations or start the worker.

Read the random tunnel origin from the tunnel terminal, set `REVIEW_PUBLIC_ORIGIN` to it, then restart the server/worker with that value before review testing. Quick-tunnel hostnames change on each tunnel restart.

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

Enqueue derives its namespace from persisted `clip_requests.is_test`: a test request always uses `test_queued`, even in a normal process. A test process refuses non-test requests. New worker claims additionally require matching request ownership; production device claims exclude test requests.

Touch, complete and release only update the current mode's claimed state and matching request ownership, with claimed_by matching for the claim APIs. Repeated release is a no-op; done/failed tasks cannot be reopened. Releases preserve the namespace. **Pre-existing residual risk:** worker touch/complete/release do not check claimed_by. After stale reclaim, the old worker can mutate the new claim. This is not claim-token isolation; fixing it safely requires per-claim identity and handling rejected completion before downstream pipeline writes. Deferred here.

**Prerequisites: migrations 054, 049, 057 and 058 must be applied before Phase 2.** 057 adds the test-state indices. Without its original explicit test-state conflict index PostgreSQL rejects enqueue; it does not silently insert duplicates. New enqueue requires 058's unique index across all four active states, preventing simultaneous production/test active rows for one job. The additive migration fails on existing duplicates; investigate before proceeding.

`scripts/phase2-start.ps1` runs the read-only `check-phase2-schema.cjs` catalog check before starting a server or tunnel, and fails closed if either unique index is missing or invalid, its sole indexed key is not job_id, or its normalized predicate differs from the exact required active states (extra restrictions are rejected). This check has not been run during offline verification.

**enqueue DO NOTHING preserves active tasks.** After an empty insert, a fresh SELECT reads the existing active row unchanged. If it completed meanwhile, enqueue retries up to three times and throws on exhaustion; it never updates an existing task to recover a conflict.

**video_generation_jobs — claimNextQueuedRenderStep JOIN guard**

`PostgresVideoGenerationJobRepository.claimNextQueuedRenderStep()` now joins `clip_requests` and filter by `cr.is_test` based on `LINE_TEST_MODE`. Note: the old Mac Mini worker does NOT call this method (it uses the `render_tasks` queue). The JOIN guard protects any NEW code calling this path; `is_test` state-value isolation is not needed here.

**asset_visual_analyses — claim and expiry guards**

`PostgresAssetVisualAnalysisRepository.claim()` and `expireClaims()` join `uploaded_assets → clip_requests` and filters by `cr.is_test`, including expired IDs returned for follow-up. Asset IDs join as TEXT (`ua.id = ava.asset_id`). Non-test worker skips assets from test requests; test worker claims only test-request assets. LEFT JOINs mean assets with no associated request (orphaned uploads) are treated as non-test. Requires migration 054 for `cr.is_test`.

**review_outbox ? exact owner scope**

Claims resolve persisted request ownership (including storyboard version/job references) first, then package-order ownership, then the owning LINE account for account-only events. The resolved is_test must equal worker mode in both directions. Unknown ownership fails closed; payload is_test is not trusted. Delivery events now carry request_id.

| SQL source | Tables | Mutation / isolation |
|---|---|---|
| `src/repositories/postgres/PostgresUserRepository.ts:41` | `users` | INSERT; test emails use a separate `:test` hash namespace. |
| `src/repositories/postgres/PostgresLineAccountRepository.ts:49,66,73,104,107` | `line_accounts / line_conversation_states` | INSERT and UPDATE. Intake rejects account/mode mismatch for global test mode and exact test-shop matching. Conversations lack `is_test`; use a distinct test channel. |
| `src/repositories/postgres/PostgresServicePackageRepository.ts:97,162,188,225` | `package_orders / package_usage / clip_requests` | INSERT/UPDATE. Active-order lookup requires exact mode; consumption requires persisted request/order user and is_test equality. |
| `src/repositories/postgres/PostgresClipRequestRepository.ts:283,315,367,400,475` | `clip_requests` | INSERT and UPDATE metadata/status. Adapters target request IDs; no universal test-only UPDATE guard (writes are scoped to the test request). |
| `src/repositories/postgres/PostgresUploadedAssetRepository.ts:83,153` | `uploaded_assets` | INSERT intake/AI/render outputs; UPDATE metadata. Scoped by request or asset ID. |
| `src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:266,387,541,573,575,608,623,632` | `video_generation_jobs / step_history / heartbeat` | INSERT job/history/heartbeat; UPDATE pipeline state and claims. `claimNextQueuedRenderStep` is now guarded by `cr.is_test` JOIN filter. Other `update()` calls are scoped by job ID (owned by the test request). |
| `src/repositories/postgres/PostgresRenderTaskRepository.ts` | `render_tasks` | **GUARDED.** Test jobs enqueued as `test_queued`; claimed as `test_claimed`. Old Mac Mini worker cannot see or reclaim test tasks. `enqueue()` is now DO NOTHING (never resets active tasks). |
| `src/repositories/postgres/PostgresAssetVisualAnalysisRepository.ts` | `asset_visual_analyses` | **GUARDED.** `claim()` and `expireClaims()` filter `clip_requests.is_test`; expired IDs are mode-scoped. TEXT asset joins. Requires migration 054. |
| `src/repositories/postgres/PostgresReviewItemRepository.ts:72,204,251` | `review_items` | INSERT gate/escalation; UPDATE decision and reminder bookkeeping. Reminder job and admin list are not globally test-filtered. |
| `src/repositories/postgres/PostgresReviewActionRepository.ts:35` | `review_actions` | INSERT immutable decision/action audit. |
| `src/repositories/postgres/PostgresReviewOutboxRepository.ts:41,45,60,83,90,101` | `review_outbox` | **GUARDED.** Persisted owner scope must equal worker mode; unknown owners are skipped. |
| `src/app/api/line/webhook/route.ts:43,169,172` | `line_webhook_events` | INSERT or conflict UPDATE lease; UPDATE completed/failure. No `is_test` column; use a distinct test channel. |
| `scripts/render-worker.ts:159` | `render_worker_samples` | INSERT telemetry. Worker uses the guarded `renderTaskRepository.claimNext()` and `reviewOutboxRepository.claimNext()`. |

Frame retention (`purgeOldFrameData`) remains a global maintenance operation, not a worker claim operation: it only clears frame data on old completed analyses. Run it separately with explicit maintenance scope; LINE_TEST_MODE does not scope retention. Automatic test payment bypass uses the test-account/test-shop checks; PAYMENT_DISABLED remains an explicit global bypass. Neither payment path changes render namespace ownership.

#### Old Mac Mini worker — residual risk assessment

The old deployed Mac Mini worker's claim paths:
- `render_tasks`: `WHERE device_only = FALSE AND (state = 'queued' OR (state = 'claimed' AND ...stale...))` — **SAFE.** Test jobs use `test_queued`/`test_claimed`; invisible by construction.
- `video_generation_jobs.claimNextQueuedRenderStep`: **NOT CALLED** by the old worker (it uses the `render_tasks` queue). No risk.
- `asset_visual_analyses.claim()`: the visual analysis worker code was introduced in the same branch as this guard. If the old deployed Mac Mini doesn't have the visual analysis worker code at all, no claim is made. If it does, the guard was not present in the old code — that deployment has no guaranteed isolation: it may claim test analyses, call providers, and perform follow-up work. Verify deployed code before permitting this phase; no harmlessness guarantee is made.
- `render_worker_heartbeat`, `render_worker_samples`: shared telemetry tables, no production data risk.

#### Management jobs ? unguarded; test publishing blocked operationally

Do not permit the social-publishing phase for test requests in the shared production database until test-only queue routing or comprehensive creation/claim guards exist. management_jobs lacks is_test, and both repository enqueue and the provider webhook create jobs. No code guard is claimed here: a repository-only change would leave the webhook path open. Existing test publications/jobs can be processed by a production management worker with social credentials, including external publishing calls. Missing credentials on Mar-PC provides no protection against that worker. STRIPE_ALLOW_LIVE=false constrains Stripe, not social publishing. Do not create test publications or management jobs during Phase 2; this is an operational restriction, not enforced isolation.

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
| **058** | **`058_render_task_active_namespace.sql`** | **Unique active job across production and test namespaces** |

**DELETE audit:** No SQL DELETE is invoked by the normal LINE intake/review/render progression. Shared adapters expose DELETE methods that are not called by that progression. The optional cleanup helper `src/services/line/cleanupLineAssets.ts:19` deletes storage objects (not DB rows) only with `execute=true`. Do not run cleanup for this audit.

**Remaining limits:** Conversation states (`line_conversation_states`) and webhook leases (`line_webhook_events`) lack `is_test` — use a distinct test LINE channel and test shop identity. Reminder selection and admin review APIs can see earlier/production reviews; do not run the reminder script or use an unfiltered admin list against the live DB as a test. `clip_requests` and `video_generation_jobs` adapter methods (update/status) are scoped by ID, not by `is_test` predicate — the caller must supply test-owned IDs; these methods do not themselves guarantee test-only writes. Management jobs are unguarded (see above).

Only Mar-PC may enable these test flags; never enable them on production `/root/rc2`. Keep `STRIPE_ALLOW_LIVE=false`. Apply migrations 048–058 before starting the test server.

### 3f. Payment Bypass — `PAYMENT_DISABLED` flag

To skip Stripe during Phase 2 testing, set `PAYMENT_DISABLED=true` in `.env.local`.

**Behaviour per path:**

| Path | `PAYMENT_DISABLED` | `LINE_TEST_MODE` / `LINE_TEST_SHOP_ID` | Result |
|---|---|---|---|
| Test shop (user matches test scope) | any | true | `choosePackage` creates a `package_orders` row with `status='active'`, `is_test=true`, `paidReference='payment_disabled'`. No Stripe link sent. Conversation moves straight to `awaiting_brief`. |
| Real shop | `false` | false | Normal Stripe flow: `package_orders` row with `status='pending_payment'`; Stripe payment link sent. |
| Real shop | `true` | false | Same INSERT as test path but `is_test=false`, `paidReference='payment_disabled'`. No Stripe link. Conversation goes straight to `awaiting_brief`. **Use only in controlled test environments — real shops get a free package.** |

**Guarantees:**

- **Order creation/reuse:** bypass reuses an available active order in the same scope or inserts `package_orders` directly with `status='active'`, `starts_at`, expiry, included clips/revisions, `is_test` and `paid_reference='payment_disabled'`. It never updates existing orders, including pending Stripe orders. No schema changes are needed.
- **Balance/usage:** the Stripe paid path only activates the order; there is no separate allowance grant row. Balance is `clips_included` minus net `package_usage`. Bypass inserts the same allowance on the order; no usage row is inserted until an actual request consumes a clip through the existing idempotent `recordUsage` path.
- **Idempotency:** route event deduplication remains wired to `choosePackage` / `isPaid`. Repository creation holds the per-user/test-scope advisory transaction lock shared with usage consumption and reuses an unexpired active balance in that scope, even for concurrent deliveries or another package choice. It does not grant a second available balance or modify the existing balance.
- **Stripe code is untouched:** the bypass is a conditional in `LineIntakeService.choosePackage`. All Stripe routes continue to function normally when `PAYMENT_DISABLED` is unset or `false`.
- **Audit marker:** `package_orders.paidReference = 'payment_disabled'` (existing column, no schema change required) identifies bypass-activated orders.

**Never set `PAYMENT_DISABLED=true` on production (`/root/rc2`).** Keep it in `.env.local` on Mar-PC only.

Test scope means `LINE_TEST_MODE=true` **and an `is_test` account**, or an exact `LINE_TEST_SHOP_ID` match with an `is_test` account. Both global test mode and exact test-shop mode reject existing real accounts; normal mode rejects existing test accounts. Real shops otherwise receive a Stripe link unless `PAYMENT_DISABLED` is exactly `true`; that explicit override creates a real (`is_test=false`) active order with the audit marker above.

### 3g. Visual frame retention

`scripts/cleanup-line-uploads.ts` remains dry-run unless `--execute` is supplied. In addition to the existing seven-day LINE upload prefixes (`request_mat/line/`, `line_uploads/`), it counts completed `asset_visual_analyses` rows created more than seven days ago with frame image data. Execute sets only each frame's `data` to JSON null in that new table; detections, timestamps, cuts and metrics remain available. No pre-existing table is written by frame cleanup. Counts are rows, not individual frames (`framesPurged` is the candidate count in dry-run).

Visual frame extraction and contact sheets use FFmpeg memory pipes; no visual-analysis frame directories or S3 prefixes are written, so no extra file/object deletion scope is added. Consumers skip purged images and retain uncertain-shot flags if no contact sheet can be built. The cleanup script was not run during preparation.

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

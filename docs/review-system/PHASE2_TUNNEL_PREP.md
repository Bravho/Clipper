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

### 3e. Live database mutation audit (Round 4b)

The LINE flow is **not append-only**. It inserts into existing tables and updates rows that can predate the current test session. A live database is not isolated by feature flags or render lanes. The audit below lists SQL mutation sites reachable through intake, review and rendering, including shared worker bookkeeping. It does not authorize running any of them during offline verification.

| SQL source (file:line) | Tables | Actual mutation / isolation |
|---|---|---|
| `src/repositories/postgres/PostgresUserRepository.ts:41` | `users` | INSERT; deterministic LINE email reuse is read-only. Test emails use a separate :test hash namespace. |
| `src/repositories/postgres/PostgresLineAccountRepository.ts:49`<br>`src/repositories/postgres/PostgresLineAccountRepository.ts:66`<br>`src/repositories/postgres/PostgresLineAccountRepository.ts:73`<br>`src/repositories/postgres/PostgresLineAccountRepository.ts:104`<br>`src/repositories/postgres/PostgresLineAccountRepository.ts:107` | `line_accounts / line_conversation_states` | INSERT and UPDATE, including lazy takeover expiry and conversation upsert. Account reuse is blocked if LINE_TEST_MODE=true and is_test=false; conversations have no is_test column. |
| `src/repositories/postgres/PostgresServicePackageRepository.ts:97`<br>`src/repositories/postgres/PostgresServicePackageRepository.ts:162`<br>`src/repositories/postgres/PostgresServicePackageRepository.ts:188`<br>`src/repositories/postgres/PostgresServicePackageRepository.ts:225` | `package_orders / package_usage / clip_requests` | Pending order INSERT or locked reuse; Stripe activation UPDATE; atomic oldest-balance usage INSERT and request order UPDATE. Existing test orders and balances may be reused across sessions. Active lookup is test-filtered; consumption matches order is_test. |
| `src/repositories/postgres/PostgresClipRequestRepository.ts:283`<br>`src/repositories/postgres/PostgresClipRequestRepository.ts:315`<br>`src/repositories/postgres/PostgresClipRequestRepository.ts:367`<br>`src/repositories/postgres/PostgresClipRequestRepository.ts:400`<br>`src/repositories/postgres/PostgresClipRequestRepository.ts:475` | `clip_requests` | INSERT and UPDATE metadata/status. Service targets request IDs, including resumed earlier test intakes; adapters have no universal test-only UPDATE guard. |
| `src/repositories/postgres/PostgresUploadedAssetRepository.ts:83`<br>`src/repositories/postgres/PostgresUploadedAssetRepository.ts:153` | `uploaded_assets` | INSERT intake/AI/render outputs; UPDATE upload/storage/derivative metadata through shared adapters. Scoped by request or asset ID, not an is_test predicate. |
| `src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:266`<br>`src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:387`<br>`src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:541`<br>`src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:573`<br>`src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:575`<br>`src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:608`<br>`src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:623`<br>`src/repositories/postgres/PostgresVideoGenerationJobRepository.ts:632` | `video_generation_jobs / video_generation_step_history / render_worker_heartbeat` | INSERT job/history/heartbeat; UPDATE pipeline state, worker claims, heartbeat and release. Shared workers can mutate pre-existing jobs; no universal is_test guard. |
| `src/repositories/postgres/PostgresRenderTaskRepository.ts:76`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:79`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:113`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:116`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:171`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:213`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:240`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:258`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:267`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:279`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:290`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:303`<br>`src/repositories/postgres/PostgresRenderTaskRepository.ts:319` | `render_tasks` | INSERT enqueue; conflict UPDATE may reset an existing queued/claimed task; UPDATE claim, device claim, heartbeat/touch, completion/failure and release. Render lane routing is not test-data isolation. |
| `src/repositories/postgres/PostgresReviewItemRepository.ts:72`<br>`src/repositories/postgres/PostgresReviewItemRepository.ts:204`<br>`src/repositories/postgres/PostgresReviewItemRepository.ts:251` | `review_items` | INSERT gate/escalation; UPDATE decision, supersede, opened and reminder claim/send bookkeeping. Reminder job and admin list are not globally test-filtered. |
| `src/repositories/postgres/PostgresReviewActionRepository.ts:35` | `review_actions` | INSERT immutable decision/action audit. |
| `src/repositories/postgres/PostgresReviewOutboxRepository.ts:41`<br>`src/repositories/postgres/PostgresReviewOutboxRepository.ts:45`<br>`src/repositories/postgres/PostgresReviewOutboxRepository.ts:60`<br>`src/repositories/postgres/PostgresReviewOutboxRepository.ts:83`<br>`src/repositories/postgres/PostgresReviewOutboxRepository.ts:90`<br>`src/repositories/postgres/PostgresReviewOutboxRepository.ts:101` | `review_outbox` | INSERT or dedupe UPDATE; UPDATE claim lease/attempts, sent, failed, dead. In LINE_TEST_MODE=true only events linked to test requests/accounts or explicitly tagged is_test are claimed. This includes prior test-session events. |
| `src/app/api/line/webhook/route.ts:43`<br>`src/app/api/line/webhook/route.ts:169`<br>`src/app/api/line/webhook/route.ts:172` | `line_webhook_events` | INSERT or conflict UPDATE lease; UPDATE completed_at or clear lease on failure. No is_test column; shared channel/event IDs can overlap another process. |
| `scripts/render-worker.ts:159` | `render_worker_samples` | INSERT worker telemetry. Worker also calls shared job/task heartbeat, claim, complete and release adapters listed above. |

Key production callers: `src/services/line/LineIntakeService.ts:25` (account reuse/create), `src/services/line/LineIntakeService.ts:49` (pending order reuse), `src/services/line/LineIntakeService.ts:68` (request/assets/usage/status), `src/services/VideoGenerationService.ts:503` (job creation), `src/services/VideoGenerationService.ts:1360` (render queue), `src/services/VideoGenerationService.ts:2412` (request metadata), `src/services/VideoGenerationService.ts:4165` (delivery status), `src/services/line/LineReviewOutboxWorker.ts:14` (outbox worker), `src/services/review/ReviewReminderService.ts:27` (one-time reminder reservation).

**DELETE audit:** No SQL DELETE is invoked by the normal LINE intake/review/render progression. Shared adapters expose DELETE methods at `src/repositories/postgres/PostgresUserRepository.ts:90`, `src/repositories/postgres/PostgresClipRequestRepository.ts:483`, `src/repositories/postgres/PostgresUploadedAssetRepository.ts:161`, and `src/repositories/postgres/PostgresUploadedAssetRepository.ts:166`; these are not called by that progression. The separate optional cleanup helper `src/services/line/cleanupLineAssets.ts:19` deletes storage objects, not DB rows, only with execute=true. Do not run cleanup for this audit.

**Limits that remain:** render task enqueue/claim/complete and worker telemetry are shared, without test-only predicates. Reminder selection and admin review APIs can see earlier/production reviews; do not run the reminder script or use an unfiltered admin list against the shared live DB as a test. Conversation states and webhook leases lack is_test, so use a distinct test channel and test shop identity. LINE_TEST_MODE blocks reuse of a non-test account (including takeover mutation) rather than retagging it; it does not silently convert production accounts. Test users have a separate deterministic email namespace. Package/payment IDs still require normal authenticated ownership and Stripe test-event validation. Existing test balances may be reused, and multiple previously paid orders are deliberately retained and consumed oldest-first under a user lock rather than discarding purchased clips. Non-LINE shared adapter methods are unchanged.

Only Mar-PC may enable these test flags; never enable them on production /root/rc2. Keep STRIPE_ALLOW_LIVE=false and use Stripe test links. Apply migrations manually in the exact 048, 049, 050, 051, 052, 053, 054 order listed above; none was applied here. is_test tags remain required on accounts, orders and requests. These measures reduce scope but do not establish full live-database isolation.

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

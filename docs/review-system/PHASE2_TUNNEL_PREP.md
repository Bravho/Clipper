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

### 3e. No DELETE or UPDATE on Existing Production Rows

The LINE flow is **append-only** for pre-existing data. Every operation creates new rows or updates rows created within this same test session. The detailed audit below confirms this.

**INSERTs / UPDATEs on pre-existing tables, per file and line:**

| File | Line(s) | Table | Operation | Touches only test rows? |
|------|---------|-------|-----------|------------------------|
| `src/services/line/LineIntakeService.ts` | ~32 | `users` | INSERT (new user, deterministic email) | Yes — new row per LINE shop |
| `src/services/line/LineIntakeService.ts` | ~34 | `line_accounts` | INSERT | Yes — new row, is_test=true |
| `src/services/line/LineIntakeService.ts` | ~52 | `package_orders` | INSERT | Yes — new row, is_test=true |
| `src/services/line/LineIntakeService.ts` | ~79 | `clip_requests` | INSERT | Yes — new row, is_test=true |
| `src/services/line/LineIntakeService.ts` | ~89 | `uploaded_assets` | INSERT (per file) | Yes — linked to new request |
| `src/services/line/LineIntakeService.ts` | ~95 | `package_usage` | INSERT | Yes — linked to new order |
| `src/services/line/LineIntakeService.ts` | ~96 | `clip_requests` | UPDATE status → Submitted | Yes — only the row just created |
| `src/services/VideoGenerationService.ts` | ~503 | `video_generation_jobs` | INSERT | Yes — new job for new request |
| `src/services/VideoGenerationService.ts` | ~560+ | `video_generation_jobs` | UPDATE (pipeline phases) | Yes — only the new job |
| `src/services/VideoGenerationService.ts` | ~1239+ | `uploaded_assets` | INSERT (AI outputs) | Yes — linked to new job |
| `src/services/VideoGenerationService.ts` | ~2412, ~4165+ | `clip_requests` | UPDATE (metadata, status) | Yes — only the new request |
| `src/services/review/lineReviewGate.ts` | ~39 | `review_items` | UPDATE (supersede old gate) | Yes — new review item |
| `src/services/review/lineReviewGate.ts` | ~73 | `video_generation_jobs` | UPDATE (storyboard regen) | Yes — only the new job |
| `src/services/review/ReviewService.ts` | ~189 | `review_items` | INSERT | Yes — new review card |
| `src/services/review/ReviewService.ts` | ~273, ~301, ~329 | `review_items` | UPDATE (approve/reject/edit) | Yes — new review items only |
| `src/app/api/line/webhook/route.ts` | ~43-47 | `line_webhook_events` | INSERT…ON CONFLICT UPDATE | Yes — event dedup for this test |
| `src/services/line/LineWebhookService.ts` | ~193 | `line_accounts` | UPDATE setTakeover(false) | Yes — test account only |

**Tables never touched by LINE flow:**
- `render_tasks` — not used by LINE flow
- `credit_wallets`, `credit_transactions` — LINE flow uses package_orders, no credits
- Any other existing user's rows — all operations are on newly created rows

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

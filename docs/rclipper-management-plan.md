# RClipper Management — Repository Findings & Implementation Architecture

Status: **Design document.** Written before implementation; Phase 0–2 have since
been built. See [`rclipper-management.md`](./rclipper-management.md) for the
operational reference and current status.
Date: 2026-07-29

> ### ⚠️ SUPERSEDED IN TWO IMPORTANT WAYS
>
> This document gated payment at **transfer** time and assumed all content came
> from the generator. Both changed. The current model is in
> [`rclipper-management.md`](./rclipper-management.md); read that first.
>
> 1. **Payment moved to publish time.** Transferring is now FREE and optional,
>    and so is uploading. Money is required only immediately before a video is
>    submitted to social channels. The `management_single_transfer` product
>    became `management_single_video` — a permanent unlock for publishing ONE
>    video, never consumed by use — and the
>    `management_single_transfer_entitlements` table became
>    `management_publish_entitlements`.
> 2. **Management accepts user uploads.** A user can bring any video, so it works
>    as a standalone multi-channel publishing tool rather than only an extension
>    of the generator. `source_generation_id` and
>    `management_content_assets.source_video_id` are therefore nullable.
> 3. **Media has a retention window** (default 90 days) while the record and any
>    purchased unlock last indefinitely. The retention pin in §4 (**G4/G5**) is
>    consequently time-bounded rather than permanent.
>
> Everything else below — the entitlement service shape, calendar arithmetic,
> idempotency guarantees, provider abstraction and Post for Me research — still
> holds.
>
> **Earlier decisions** (they supersede §6.1, §9, and open questions Q1–Q5 below):
>
> * **Payment is by CREDITS.** Management packages are bought by debiting the
>   existing credit wallet. Credits are topped up through the already-verified
>   rails — Stripe on web, Apple IAP and Google Play Billing in the native
>   shells. This removes the need for a second payment provider, new price
>   objects, or a new webhook, and it dissolves gap **G6** entirely: in-app
>   money always enters through the platform's own billing, so App Store
>   guideline 3.1.1 and the Play equivalent are satisfied by construction.
> * **Prices** (launch, 50 % off): Single Transfer **50**, 3-month **300**,
>   6-month **550**, 1-year **1000** credits. 1 credit = ฿1. List prices are
>   double, switched by one flag, mirroring `CREDITS_CONFIG`.
> * Everything else in this document — the entitlement model, calendar
>   arithmetic, idempotency guarantees, database design, provider abstraction,
>   and the retention-pinning fix for **G4/G5** — stands as written.

---

## 1. Repository findings

### 1.1 Framework, build, conventions

| Area | Finding |
|---|---|
| Framework | Next.js **14.2** App Router, React 18.3, TypeScript 5 |
| Styling | Tailwind 3.4 + `clsx` / `tailwind-merge`. No component library — hand-rolled primitives in `src/components/ui/` (`Button`, `Card`, `Badge`, `Input`, `Select`, `Textarea`, `Checkbox`) |
| Validation | **Zod 3** + `react-hook-form` + `@hookform/resolvers`. Schemas live in `features/*/validation/` |
| Testing | **Jest 29** + `ts-jest`, `jest-environment-node`. Tests in `tests/`, mirroring `src/services/`. Pattern: instantiate services with **fresh Mock repositories** (`new MockXRepository(new Map())`), never the global registry |
| Lint | `next lint` / `eslint-config-next` |
| Config gotchas | `next.config.js` and `jest.config.js` must stay `.js` (not `.ts`) |
| Logging | `console.log/warn/error` with a bracketed prefix convention: `[POST /api/…]`, `[payments]`, `[poll backstop]`. No structured logger library |
| Error handling | API routes return `NextResponse.json({ error: "…" }, { status })`; services throw `Error` with a message the route maps to a status code |
| Date library | **None installed.** No `date-fns`, `dayjs`, or `luxon`. All date maths is native `Date` |
| Mobile | Capacitor 6 iOS + Android shells (`ios/`, `android/`), `@capgo/native-purchases` for StoreKit / Play Billing |

### 1.2 Routing and layout

- Route groups: `src/app/(public)/`, `src/app/(auth)/`, `src/app/api/`.
- `src/middleware.ts` wraps `/dashboard/:path*`, `/admin/:path*`, `/account/:path*` with NextAuth `withAuth`; **`/dashboard` is `Role.Requester` only**, so `/dashboard/management/*` inherits requester-only protection with zero middleware changes.
- `src/app/(auth)/layout.tsx` is a server-side belt-and-braces session check.
- `src/app/(auth)/dashboard/layout.tsx` is a **client component** rendering the sidebar from a hard-coded `navLinks` array built from `ROUTES` + `useI18n()`. This is the single insertion point for the "RClipper Management" nav item.
- Route constants: `src/config/routes.ts` (`ROUTES`, `requestDetailPath()`, `getRoleHomePath()`).
- i18n: bespoke, `src/i18n/{config,messages,client,server}.ts`, `useI18n()` → `t(key)`. Locales include `th` (default) and `en`.

### 1.3 Auth

- NextAuth v4, JWT sessions. `src/lib/auth/authOptions.ts`, helpers in `src/lib/auth/helpers.ts`.
- Providers: credentials, Google, Apple.
- Session shape: `{ id, email, name, role, provider }`. Roles enum `src/domain/enums/Role.ts` (`Requester`, `Editor`, `Admin`).
- Every API route independently calls `getServerSession(authOptions)` and re-checks role — no reliance on middleware alone.

### 1.4 Database and data access

- **PostgreSQL via raw `pg`** — no ORM. Query helper in `src/lib/db.ts`.
- Layered repository pattern: `domain/models` (pure types) → `repositories/interfaces` → `repositories/postgres` (or `mock`) → `repositories/index.ts` (**the only file that instantiates implementations**) → `services/`.
- Two migration folders, both applied with `node scripts/apply-migration.js <file>`:
  - `migrations/` — `002`…`009` (payments, trial gate, watermarked previews)
  - `src/db/migrations/` — `002`…`018` (pipeline, render queue, account deletion, render progress, video feedback)
  - **Numbering is not globally unique across the two folders**, and `src/db/migrations/` is the active one for feature work. New migrations belong there, next free number: **`019`**.
- Migrations are hand-written, idempotent (`IF NOT EXISTS`), with a `schema_migrations_meta` marker table for non-idempotent backfills.
- `gen_random_uuid()` via `pgcrypto` is the id convention for newer tables.

### 1.5 Payments — the single most reusable system

- Provider: **Stripe** (`stripe@22`, `@stripe/stripe-js@9`). GB Prime Pay exists only as a historical enum value; its webhook route is a stub.
- Config: `src/config/payments.ts` — `PAYMENTS_CONFIG`, `requireStripeSecretKey()` (refuses `sk_test` in production), `requireStripeWebhookSecret()`.
- Gateway wrapper: `src/lib/payments/stripe.ts` — `createPromptPayQr()`, `createCardCheckout()`, `getChargeStatus()`, `toChargeStatus()`, `constructStripeEvent()`.
- Two payment methods, both **one-time** already: THB **PromptPay QR** (`paymentIntents.create` with `payment_method_types: ["promptpay"]`) and **Card Checkout** (`checkout.sessions.create` with `mode: "payment"`). **No subscription code exists anywhere in the repo** — the "no recurring billing" requirement is already satisfied by the current architecture.
- Ledger: `payment_intents` table (migration `007`), model `src/domain/models/PaymentIntent.ts`, statuses `pending | paid | expired | failed`.
- Orchestration: `src/services/PaymentService.ts`. This is the reference implementation for everything RClipper Management needs:
  - `referenceNo` (ours, `RC-<ts>-<rand>`) used as the **Stripe idempotency key**;
  - `settleFromWebhook()` re-verifies server-to-server, never trusts the event payload alone;
  - `markPaidIfPending()` — an **atomic `Pending → Paid` claim** so a webhook and a poll cannot double-credit;
  - amount + currency + reference cross-checks before crediting;
  - a **poll-side backstop** (`pollIntentStatus`) that settles a payment even if the webhook is never delivered, throttled per-intent.
- Webhook: `POST /api/payments/stripe/webhook` — `constructStripeEvent(await request.text(), signature)`, handles `payment_intent.succeeded`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`.
- Mobile IAP: `src/services/MobileStorePurchaseService.ts` + `src/config/mobilePurchases.ts` + `POST /api/mobile/purchases/verify`, with App Store Server API and Google Play Android Publisher verification.
- Money: THB, stored as `NUMERIC(10,2)` (`amount_baht`); credits are integers with **1 credit = ฿1**.

### 1.6 Credits / entitlement precedent

- `src/config/credits.ts` — flat `REQUEST_COST_CREDITS` (50 launch / 100 list), `TOPUP_BUNDLES`, `LAUNCH_DISCOUNT_ACTIVE` flag.
- `src/services/CreditService.ts` + immutable `credit_transactions` ledger.
- **The closest existing analogue to a Single Transfer entitlement** is the trial download gate (migration `008`): `clip_requests.download_unlocked` + `is_trial_request`, unlocked by `POST /api/requests/[id]/unlock-download` → `clipRequestService.unlockDownload()`. It is a per-project, one-time, non-recurring paid unlock — exactly the shape of `management_single_transfer`.

### 1.7 Video generation workflow

- `src/services/VideoGenerationService.ts` orchestrates one `VideoGenerationJob` per `ClipRequest`.
- Job model: `src/domain/models/VideoGenerationJob.ts`; steps enum `VideoGenerationStep`; job status enum `VideoGenerationJobStatus`.
- Current engine is **Remotion montage** from real user media (Veo was removed and parked).
- Final artefacts on the job record:
  - `finalExport_{9_16,16_9,1_1,4_5}_assetId` — un-captioned masters
  - `captionedExport_{9_16,16_9,1_1,4_5}_assetId` — **the delivered videos** (master + subtitle/motion overlay)
  - `finalExport_travy_assetId` — Travy export, fixed 16:9, EN+ZH
- Terminal steps: `AwaitingAdditionalRatios` → `GeneratingAdditionalRatios` → `Publishing` → `Complete`.
- Per-channel post copy already exists: `ChannelPublishingDraft[]` (Phase 8 "post kit") — platform, caption, title, hashtags, preview image, locale. Generated by the pipeline, editable, regenerable via `POST /api/requests/[id]/regenerate-publishing-drafts`.

### 1.8 Final distribution step (the transfer entry point)

- Page: `src/app/(auth)/dashboard/requests/[id]/page.tsx` (975 lines, server component).
- Panel: `src/features/requests/components/DistributionReviewPanel.tsx` (643 lines, client component) — receives `initialDrafts`, `channelVideos[]` (`{platform, label, ratio, url, assetId}`), `downloadLocked`, `unlockPrice`, `mediaExpired`.
- **Phase 8 decision (already shipped): this step no longer auto-publishes.** It is download-only + optional Travy curation; the `src/lib/social/*` services are dormant. RClipper Management therefore does not conflict with or duplicate an active publishing path — it *reintroduces* publishing, but to the **user's own** connected accounts rather than RClipper's.
- Download gate: `downloadLocked` → `UnlockDownloadPanel` → `POST /api/requests/[id]/unlock-download`. Actual bytes: `GET /api/requests/[id]/download` and `GET /api/requests/[id]/stream` (same-origin stream route).

### 1.9 Storage

- DigitalOcean Spaces via `@aws-sdk/client-s3` + `s3-request-presigner`.
- `src/lib/spaces.ts` — `spacesUpload()`, `spacesPublicUrl(key)`, `spacesSignedUrl(key, ttl)`, `SIGNED_URL_TTL_SECONDS = 3600`, `spacesSendWithRetry()`.
- Key scheme: `src/lib/spacesKeys.ts` + `src/config/mediaPrefixes.json`.
- Assets are rows in `uploaded_assets` (`UploadedAsset` model, `AssetType` enum) — **stable storage keys are already the persisted identity**, signed URLs are derived on read. This matches the spec's "prefer stable storage keys" requirement with no change.
- **Retention:** `src/services/StorageLifecycleService.ts` + `src/config/retention.ts` + `scripts/retention-sweep.js` purge generated media after a ~7-day availability window (`mediaExpired` in the UI).

### 1.10 Background jobs / queue

- There is **one** queue, and it is not general-purpose: the render-queue claim seam on `video_generation_jobs` (migration `010`) — `render_state`, `render_step`, `render_payload`, `claimed_by`, `claimed_at`, `render_heartbeat_at`, plus a `render_worker_heartbeat` table. Config in `src/config/renderQueue.ts`; worker `scripts/render-worker.ts` (`npm run worker`), running on a Mac Mini; the droplet falls back to inline execution when no fresh heartbeat exists.
- Everything else is **synchronous-in-request** plus **webhook-driven settlement** plus **poll/reconcile-on-read backstops** (`PaymentService.pollIntentStatus`, `reconcileFailedRender`).

### 1.11 Notifications

- Email: `src/lib/email.ts` → `sendEmail()`, Resend HTTP API with SMTP fallback (droplets block outbound SMTP).
- Push: `src/services/PushNotificationService.ts` (FCM HTTP v1 + APNs), device registry via `POST /api/mobile/push-device`.
- No in-app notification centre.

### 1.12 Feature flags

- **No feature-flag system exists.** The only precedent is a boolean env read at module scope (`RENDER_QUEUE.enabled = process.env.RENDER_QUEUE_ENABLED !== "false"`) and a config constant (`CREDITS_CONFIG.LAUNCH_DISCOUNT_ACTIVE`).

### 1.13 Requested code locations — exact answers

| # | Responsibility | Location |
|---|---|---|
| 1 | Completing a video-generation request | `src/services/VideoGenerationService.ts` → `VideoGenerationStep.Complete`; request-side `RequestWorkflowService.ts` → `RequestStatus.Delivered` |
| 2 | Creating channel-specific variants | `VideoGenerationService` `_runFFmpegComposition` / additional-ratios step → `captionedExport_*_assetId`, `finalExport_travy_assetId`; ratio mapping in `Platform.PLATFORM_ASPECT_RATIOS` |
| 3 | Showing the final generated videos | `src/app/(auth)/dashboard/requests/[id]/page.tsx` (builds `channelVideos`) → `features/requests/components/DistributionReviewPanel.tsx` |
| 4 | Downloading / distributing | `GET /api/requests/[id]/download`, `GET /api/requests/[id]/stream`, `POST /api/requests/[id]/unlock-download` |
| 5 | Creating and verifying payments | `src/services/PaymentService.ts` + `src/lib/payments/stripe.ts` + `POST /api/credits/topup` |
| 6 | Receiving payment webhooks | `src/app/api/payments/stripe/webhook/route.ts` |
| 7 | Storing video files / URLs | `src/lib/spaces.ts`, `src/lib/spacesKeys.ts`, `uploaded_assets` + `UploadService` |
| 8 | Associating videos with users | `clip_requests.user_id` → `video_generation_jobs.request_id` → asset ids on the job → `uploaded_assets` |

---

## 2. Post for Me API — verified facts

Read from the current official docs and the Stainless-generated SDK (which is generated *from* the live OpenAPI spec). **Nothing below is guessed.**

- **Base URL:** `https://api.postforme.dev` (overridable via `POST_FOR_ME_BASE_URL`)
- **Auth header:** `Authorization: Bearer <POST_FOR_ME_API_KEY>` — a **project-level** key with full administrative access to every account in the project. Server-only, never client-side.
- **Endpoints (all `/v1`):**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/social-accounts/auth-url` | Create an OAuth authorization URL |
| `GET` | `/v1/social-accounts` | List accounts (filterable by `external_id`) |
| `GET` | `/v1/social-accounts/{id}` | Retrieve one account |
| `PATCH` | `/v1/social-accounts/{id}` | Update an account |
| `POST` | `/v1/social-accounts/{id}/disconnect` | Disconnect |
| `POST` | `/v1/media/create-upload-url` | Get `{ upload_url, media_url }` |
| `POST` | `/v1/social-posts` | Create / schedule a post |
| `GET` | `/v1/social-posts/{id}` | Retrieve post |
| `PUT` | `/v1/social-posts/{id}` | Update post |
| `DELETE` | `/v1/social-posts/{id}` | Delete post |
| `GET` | `/v1/social-post-results` / `/{id}` | Per-destination outcomes |
| `POST` | `/v1/webhooks` | Create a webhook (API only — **no dashboard UI**) |

- **`POST /v1/social-accounts/auth-url` params:** `platform` (required), `external_id`, `permissions: ("posts"|"feeds")[]`, `platform_data{…}`, `redirect_url_override` (**does not work with Quickstart system credentials**).
- **`SocialAccount` fields:** `id`, `platform`, `user_id` (the platform's own id), `username`, `profile_photo_url`, `external_id`, `status: "connected" | "disconnected"`, `metadata`, plus `access_token` / `refresh_token` / expiries — **which we must never persist or log.**
- **`POST /v1/social-posts` params:** `caption` (required), `social_accounts: string[]` (required), `media: [{ url, thumbnail_url?, thumbnail_timestamp_ms?, skip_processing?, tags? }]`, `scheduled_at` (ISO-8601; null/absent ⇒ post immediately), `external_id`, `isDraft`, `platform_configurations`, `account_configurations: [{ social_account_id, configuration: { caption?, title?, privacy_status?, placement?, made_for_kids?, is_ai_generated?, … } }]`.
- **`SocialPost.status`:** `"draft" | "scheduled" | "processing" | "processed"` — note **`processed` is not "succeeded"**; per-destination success lives in results.
- **`SocialPostResult` fields:** `id`, `post_id`, `social_account_id`, `success: boolean`, `error`, `details`, `platform_data: { id?, url? }`, `media`.
- **Media:** media assets are **temporary** — deleted when the associated post publishes, after **24 h** if unattached, or when a scheduled post is deleted. Any publicly reachable URL is accepted, so the upload endpoint is optional.
- **Webhooks:** created via `POST /v1/webhooks`. Events: `social.post.created`, `social.post.updated`, `social.post.deleted`, `social.post.result.created`, `social.account.created`, `social.account.updated`. Verification is a **shared-secret header, `Post-For-Me-Webhook-Secret`**, compared against the secret returned at webhook creation — *not* an HMAC signature. Must return `2XX` within **1 second**; retries ~8 times with exponential backoff over 24 h; duplicate deliveries are expected, so handling must be idempotent.
- **OAuth redirect:** Post for Me always redirects back to the configured callback with query params `provider`, `projectId`, `isSuccess`, `accountIds`, `failedAccountIds`, `error`. **Failures are only visible on this redirect** — no webhook fires for a failed or cancelled authorization.
- **Multi-tenant model:** use `external_id` = our `users.id`, then filter `GET /v1/social-accounts?external_id=…`. A single OAuth grant may import **several** accounts (e.g. all Facebook Pages a user manages); the user picks which to keep and the rest are disconnected. Accounts are **globally unique per project** — if two RClipper users connect the same Page, Post for Me updates one record, so our own `user_id ↔ social_account_id` mapping table is mandatory.
- **Project types:** *Quickstart* (Post for Me's approved app credentials; users see the Post for Me brand in the consent screen) vs *White Label* (our own credentials; requires per-platform app review; enables `redirect_url_override` and permission overrides). Each project has its own API key, so dev/staging/prod separation is natural.

---

## 3. Existing systems to reuse (no new infrastructure)

| Need | Reuse |
|---|---|
| Auth + role gating | NextAuth + `middleware.ts` (`/dashboard` is already Requester-only) + `getServerSession` per route |
| Dashboard shell | `dashboard/layout.tsx` `navLinks` array + `ROUTES` + `useI18n()` |
| UI primitives | `components/ui/*`, Tailwind, existing panel/card idiom |
| Payment creation, verification, idempotency | `PaymentService` + `lib/payments/stripe.ts` + `payment_intents` (extended, not replaced) |
| Webhook intake | The existing `/api/payments/stripe/webhook` route, extended to dispatch by purpose |
| Persistence | Raw `pg` + repository pattern + `repositories/index.ts` registry |
| Migrations | `src/db/migrations/019_…`, applied with `scripts/apply-migration.js` |
| Media + URLs | `lib/spaces.ts` (`spacesSignedUrl`), `uploaded_assets` stable keys |
| Post copy for the composer | Existing `ChannelPublishingDraft[]` post kit — captions, titles, hashtags per platform already generated |
| Heavy/async work | Render-queue claim pattern (claim + heartbeat + stale reclaim) as the template for a management job table |
| Notifications | `lib/email.ts` `sendEmail()`, `PushNotificationService` |
| Validation | Zod schemas under `features/management/validation/` |
| Money semantics | THB, `NUMERIC(10,2)` baht, matching `payment_intents` |

---

## 4. Conflicts and gaps

| # | Issue | Severity | Resolution |
|---|---|---|---|
| G1 | **No date library installed.** The spec says "use a reliable date library already installed" — there isn't one | Medium | Do **not** add a dependency. Write `src/lib/management/calendarMath.ts` with `addCalendarMonths(dateUtc, n)` using `Date.UTC` + a month-end clamp (Jan 31 + 1 mo → Feb 28/29), and unit-test leap years, month ends and DST-adjacent dates. All storage is UTC `TIMESTAMPTZ`; display converts to user-local in the client only |
| G2 | **No general-purpose job queue.** The only queue is bolted onto `video_generation_jobs` | Medium | Add a small `management_jobs` table using the *same* claim pattern (`state`, `attempts`, `run_after`, `claimed_at`, `last_error`). Drain it from (a) the webhook path, (b) an authenticated retry endpoint, (c) a reconcile-on-read backstop mirroring `pollIntentStatus`. No Redis, no BullMQ |
| G3 | **No feature-flag system** | Low | `src/config/management.ts` reading `RCLIPPER_MANAGEMENT_ENABLED`, plus an allowlist (`RCLIPPER_MANAGEMENT_ALLOWED_EMAILS`, admin-always-on) and a deterministic percentage bucket by hashed user id. Server-evaluated; the nav item and every API route check it |
| G4 | **Media retention (~7 days) vs. scheduled posts** — generated exports are purged by the retention sweep, but a Management post may be scheduled weeks out, and Post for Me's own media copies expire in 24 h | **High** | Transferring a project must **pin** its assets: mark the referenced `uploaded_assets` as retention-exempt while a `management_content_item` references them, and teach `StorageLifecycleService` to skip pinned keys. Resolve the media URL to a **fresh signed URL at publish time**, not at transfer time |
| G5 | **Signed-URL TTL (1 h) vs. scheduled publishing** | High | Same fix as G4 — generate the signed URL inside the publish job, with a TTL comfortably exceeding Post for Me's fetch window; never persist a signed URL as an identifier |
| G6 | **iOS / Android in-app purchase rules.** RClipper ships as Capacitor native apps with StoreKit + Play Billing already wired for credits. Selling Management access **inside the native app** through Stripe would breach App Store guideline 3.1.1 | **High — needs a product decision** | Options: (a) hide the purchase UI in native builds and keep it web-only (`isNativeMobile()` already exists); (b) mirror the four products as store IAP SKUs and verify via the existing `MobileStorePurchaseService`; (c) defer native entirely. **See open question Q2** |
| G7 | **Webhook auth is a shared secret, not an HMAC.** Weaker than Stripe's scheme and it is not replay-proof | Medium | Constant-time compare the header; require HTTPS; additionally treat the webhook as *untrusted input* — re-fetch `/v1/social-post-results` / `/v1/social-accounts` server-to-server before writing anything meaningful, exactly as `PaymentService.settleFromWebhook` re-verifies with Stripe. Store `provider_event_id` for dedupe |
| G8 | **1-second webhook response budget** | Medium | The route must only verify + enqueue + `200`. All work goes to `management_jobs` |
| G9 | **Two divergent migration folders** with colliding numbers | Low | Put all new migrations in `src/db/migrations/`, starting at `019`, and note the convention in the doc |
| G10 | **Platform vocabulary mismatch.** `Platform` enum is `tiktok/facebook/instagram/youtube/travy_app/cdn`; Post for Me supports those (minus Travy/CDN) plus x, linkedin, pinterest, threads, bluesky, tiktok_business | Low | Add a mapping module `post-for-me/mappings.ts`. Never leak provider platform strings into the domain enum. Travy and CDN are **not** Post for Me destinations and stay in the existing flow |
| G11 | **Aspect-ratio coverage.** Only ratios the pipeline actually rendered exist as assets | Low | The composer offers only the variants present on the job; validate server-side that the chosen variant exists before publishing |
| G12 | **`publishing_links` / `video_publish_records` are still Mock-backed** | Low | Do not build on them. RClipper Management gets its own Postgres tables |
| G13 | Prices are unspecified | **Blocking** | See open question Q1 |

---

## 5. Proposed architecture

```
RClipper video generation  (unchanged)
        |
        v
Final channel videos  —  DistributionReviewPanel  (unchanged download path)
        |
        +--> [ new ] TransferToManagementPanel
                     |
                     v
        ManagementEntitlementService  ── evaluates ──> ManagementEntitlement
                     |  (no entitlement)
                     v
        ManagementCheckoutService ──> PaymentService ──> Stripe (one-time)
                     |
                     v          Stripe webhook (signature-verified, re-verified)
        ManagementPurchaseService  ──activates──> access pass / single transfer
                     |
                     v  (enqueued job, idempotent)
        ManagementTransferService  ──> management_content_items + assets
                     |
                     v
        /dashboard/management
                     |
                     v
        SocialPublishingProvider  (internal interface)
                     |
                     v
        PostForMeProvider  ──>  api.postforme.dev
                     |
                     +---- user's Facebook / Instagram / TikTok / YouTube
```

Layering follows the existing convention exactly:

```
src/domain/models/Management*.ts          pure types
src/domain/enums/Management*.ts           statuses
src/repositories/interfaces/IManagement*  contracts
src/repositories/postgres/PostgresManagement*  raw pg
src/repositories/index.ts                 registry (only place implementations are constructed)
src/services/management/*                 business logic, no HTTP, no React
src/services/social-publishing/*          provider abstraction
src/app/api/management/*                  thin route handlers
src/features/management/*                 UI clusters
src/config/management.ts                  flag + trusted product config
```

**Key architectural decisions**

1. **`payment_intents` is extended, not replaced.** Add `purpose` (`credit_topup` | `management`), `management_product_code`, `source_request_id`, and a `metadata` JSONB column. Existing rows default to `credit_topup`, so nothing changes for top-ups. This means Management inherits — for free — the atomic `markPaidIfPending` claim, amount/currency verification, the Stripe idempotency key, and the poll backstop.
2. **The Stripe webhook route stays a single endpoint** and dispatches on `intent.purpose`. One signature verification, one place to reason about.
3. **`source_generation_id` = `clip_requests.id`.** That is the user-facing "project"; the `video_generation_jobs` row is its production run and supplies the asset ids.
4. **Entitlement is computed, never cached in a boolean.** `ManagementEntitlementService.evaluate(userId, sourceRequestId?)` reads passes + single transfers on every call.
5. **Post for Me is reached only through `SocialPublishingProvider`.** Nothing in `app/`, `features/`, or `services/management/` imports the Post for Me client directly.

---

## 6. Payment and entitlement design

### 6.1 Products (server-trusted)

```ts
type ManagementProductCode =
  | "management_single_transfer"
  | "management_access_3_months"
  | "management_access_6_months"
  | "management_access_1_year";
```

Stored in `management_products` (DB is the source of truth; `src/config/management.ts` holds only the seed + a startup validation that every active code resolves to a row with a positive amount and `currency = 'THB'`). `duration_months` is `null` for the single transfer, else 3 / 6 / 12.

The client sends **only a product code and a source request id**. Amount, currency, duration and access type are read server-side. Any client-supplied `amount`, `currency`, `priceId`, `durationMonths` or `entitlementType` is ignored by the Zod schema (not merely unused — not present in the schema at all).

### 6.2 Entitlement evaluation

```ts
type ManagementEntitlement = {
  allowed: boolean;
  entitlementType: "single_transfer" | "three_months" | "six_months" | "one_year" | "none";
  paymentId?: string;
  accessPassId?: string;
  singleTransferId?: string;
  startsAt?: Date;
  expiresAt?: Date;
  reason?: string;
};
```

Checks, in order: authenticated session → resource ownership (`clip_requests.user_id === session.user.id`) → generation complete (`VideoGenerationJobStatus`/step is terminal **and** at least one captioned export asset exists) → existing successful transfer (→ "already transferred", not an error) → active non-revoked access pass (`now < expires_at`) → unused non-revoked single transfer for *this* `source_generation_id` → otherwise `allowed: false, reason: "payment_required"`.

Refunded / revoked rows are excluded from every branch.

### 6.3 Calendar arithmetic and overlapping passes

```
extensionStart = max(now, currentActiveExpiresAt ?? now)
newExpiresAt   = addCalendarMonths(extensionStart, durationMonths)
```

Each purchase is stored as its **own row** (`management_access_passes`), never mutated in place, so accounting stays auditable. The *effective* access window is `max(expires_at)` across active, non-revoked passes — computed by the entitlement service. Worked example from the brief: current pass expires Dec 31; a 3-month pass bought Dec 1 → new row `starts_at = Dec 31`, `expires_at = Mar 31`. Effective access = Mar 31. ✅

### 6.4 Idempotency

- **Checkout:** `idempotency_key = sha256(userId | productCode | sourceRequestId | purpose)` for single transfers; for access passes a fresh key per deliberate purchase (users may legitimately buy two passes) — but a pending, unexpired intent for the same `(user, product)` is **returned rather than recreated**, so a page refresh never opens a second checkout.
- **Settlement:** the existing atomic `Pending → Paid` claim.
- **Activation:** `UNIQUE (payment_id)` on both `management_access_passes` and `management_single_transfer_entitlements`.
- **Transfer:** partial unique index — one non-revoked fulfilled transfer per `(user_id, source_generation_id)`.
- **Publication:** `external_id` on the Post for Me post = our `management_publications.id`, and a unique constraint on `(publication_id, social_connection_id)` for targets.
- **Payment succeeded but transfer failed:** payment stays `paid`, entitlement stays active, `management_single_transfer_entitlements.status = 'failed'` with `failure_reason`; retry re-runs fulfilment only. **The user is never charged twice.**

---

## 7. Database design (migration `src/db/migrations/019_rclipper_management.sql`)

Additive and idempotent. Nine new tables plus four columns on `payment_intents`.

```sql
ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS purpose                 TEXT NOT NULL DEFAULT 'credit_topup',
  ADD COLUMN IF NOT EXISTS management_product_code TEXT,
  ADD COLUMN IF NOT EXISTS source_request_id       TEXT,
  ADD COLUMN IF NOT EXISTS metadata                JSONB;
```

| Table | Purpose | Key constraints |
|---|---|---|
| `management_products` | Trusted product config | `UNIQUE (code)`; `CHECK (duration_months IS NULL OR duration_months > 0)` |
| `management_purchases` | Mapping payment ↔ product ↔ source project | `UNIQUE (idempotency_key)`, `UNIQUE (payment_id)` |
| `management_access_passes` | One row per purchased pass | `UNIQUE (payment_id)`; idx on `user_id`, `status`, `expires_at` |
| `management_single_transfer_entitlements` | One row per Single Transfer | `UNIQUE (payment_id)`; partial `UNIQUE (user_id, source_generation_id) WHERE status IN ('paid','fulfilling','fulfilled')` |
| `management_content_items` | Transferred project | partial `UNIQUE (user_id, source_generation_id) WHERE status <> 'cancelled'` |
| `management_content_assets` | Per-variant asset rows | `UNIQUE (management_content_id, platform_variant)`; FK to `uploaded_assets` |
| `social_connections` | User ↔ Post for Me account map | `UNIQUE (user_id, provider, provider_account_id)`; **no tokens stored** |
| `management_publications` | Parent publication | idx on `user_id`, `status`, `scheduled_at` |
| `management_publication_targets` | One per destination | `UNIQUE (publication_id, social_connection_id)` |
| `management_jobs` | Idempotent async work | idx on `(state, run_after)` |
| `management_audit_events` | Financial + publishing audit trail | idx on `user_id`, `event`, `created_at` |
| `management_webhook_events` | Provider event dedupe | `UNIQUE (provider, provider_event_id)` |

Money columns mirror `payment_intents`: `amount NUMERIC(10,2)`, `currency TEXT NOT NULL DEFAULT 'THB'`. Timestamps are `TIMESTAMPTZ`, stored UTC.

Statuses follow the brief: passes `pending|active|expired|revoked|refunded`; single transfers `pending|paid|fulfilling|fulfilled|failed|refunded|revoked`; content `payment_required|payment_processing|transfer_pending|ready|draft|scheduled|publishing|partially_published|published|failed|cancelled`.

---

## 8. Post for Me provider design

```
src/services/social-publishing/
  provider.ts        SocialPublishingProvider interface
  types.ts           internal, provider-neutral types
  errors.ts          SocialPublishingError { retryable: boolean, code }
  index.ts           factory → the configured provider
  post-for-me/
    client.ts        fetch wrapper: base URL, Bearer auth, timeout, bounded retry, redaction
    accounts.ts  media.ts  posts.ts  webhooks.ts  mappings.ts  types.ts
```

The interface is the one in the brief, adjusted to what the API actually offers:

- `cancelPost?` maps to `DELETE /v1/social-posts/{id}` — only meaningful while `status` is `scheduled`.
- `refreshAccount` maps to `GET /v1/social-accounts/{id}`.
- `prepareMedia` returns `{ mediaUrl }` from a fresh Spaces signed URL, falling back to `POST /v1/media/create-upload-url` + PUT if a direct URL is ever unusable.
- Added: `verifyWebhook(headers) → boolean` and `parseWebhookEvent(raw)`.

**Status mapping**

| Post for Me | Internal target status |
|---|---|
| post `draft` | `draft` |
| post `scheduled` | `scheduled` |
| post `processing` | `publishing` |
| result `success: true` | `published` (+ `published_url` from `platform_data.url`) |
| result `success: false` | `failed` (+ classified `error_code`) |

Parent aggregation is exactly the rule set in the brief, computed from target rows only — per-platform detail is never discarded.

**Error classification** (drives retry policy): retryable = timeout, network, `429`, `>=500`, "media still processing". Non-retryable = `401`/`403`, account disconnected, unsupported media, invalid platform metadata, `422` validation.

---

## 9. API and webhook design

All under `src/app/api/management/`, all requester-role + feature-flag gated, all Zod-validated, all ownership-checked, all returning the project's `{ error }` shape.

```
GET    /api/management/overview
GET    /api/management/products
GET    /api/management/entitlement?sourceRequestId=
GET    /api/management/purchases
GET    /api/management/content
GET    /api/management/content/:id

POST   /api/management/transfers/quote        { sourceRequestId } → entitlement + priced options
POST   /api/management/transfers/checkout     { sourceRequestId, productCode, method }
GET    /api/management/transfers/:id          (also the poll backstop)
POST   /api/management/transfers/:id/retry    (paid-but-unfulfilled only)

GET    /api/management/social-accounts
POST   /api/management/social-accounts/connect   { platform } → { authUrl }
GET    /api/management/social-accounts/callback  (Post for Me redirect lands here)
POST   /api/management/social-accounts/:id/refresh
DELETE /api/management/social-accounts/:id

POST   /api/management/publications
GET    /api/management/publications/:id
POST   /api/management/publications/:id/cancel
POST   /api/management/publications/:id/retry

POST   /api/webhooks/post-for-me
```

- **No publicly callable fulfilment endpoint.** Fulfilment is triggered only by the verified Stripe webhook, the authenticated retry route (which requires an already-paid entitlement), or the reconcile-on-read backstop.
- **Connection CSRF:** `/connect` mints a signed, short-lived, single-use state token (`jose` is already a dependency) bound to `{ userId, platform, nonce }`, stored in `social_connections` as a pending row. The callback verifies the token before claiming any `accountIds`, then **re-fetches** each account from `GET /v1/social-accounts/{id}` and confirms `external_id === userId` before persisting. A user id arriving only as a URL parameter is never trusted.
- **Post for Me webhook route:** `runtime = "nodejs"`, reads the raw body, constant-time-compares `Post-For-Me-Webhook-Secret`, inserts into `management_webhook_events` (unique violation ⇒ already processed ⇒ `200`), enqueues a `management_jobs` row, returns `200` — target well under the 1-second budget.
- **Stripe webhook:** the existing route gains a dispatch on `intent.purpose`; top-up behaviour is untouched.

---

## 10. Frontend changes

| File | Change |
|---|---|
| `src/config/routes.ts` | `MANAGEMENT`, `MANAGEMENT_CONTENT`, `MANAGEMENT_CONNECTIONS`, `MANAGEMENT_CALENDAR`, `MANAGEMENT_PAYMENTS` + `managementContentPath(id)` |
| `src/app/(auth)/dashboard/layout.tsx` | One nav entry, rendered only when the flag is on for this user |
| `src/app/(auth)/dashboard/management/**` | `page.tsx` (overview), `content/`, `content/[id]/`, `connections/`, `calendar/`, `payments/` |
| `src/features/management/components/**` | `TransferToManagementPanel`, `PackagePicker`, `EntitlementBadge`, `ContentLibraryGrid`, `ConnectionList`, `ConnectAccountButton`, `AccountSelectionModal`, `Composer`, `ScheduleTimePicker`, `ScheduleList`, `PublicationTargetStatusList`, `AccessStatusCard`, `PurchaseHistoryTable` |
| `src/features/requests/components/DistributionReviewPanel.tsx` | Append a **"Manage and publish your videos"** section rendering `TransferToManagementPanel`. The existing download path is untouched |
| `src/app/(auth)/dashboard/requests/[id]/page.tsx` | Server-side entitlement + transfer lookup passed as props |
| `src/i18n/messages.ts` | th/en strings, including the mandated wording |

**Copy rules enforced in the i18n keys themselves:** allowed — *Buy access, One-time payment, Single Transfer, Prepaid access, Valid until, No automatic renewal*. Forbidden — *Subscribe, Subscription, Renews automatically, Monthly/Annual subscription, Cancel anytime*. A unit test asserts the forbidden strings appear in no management message key.

All twelve transfer states and all eleven composer states from the brief are represented as an explicit discriminated union in the panel props, so no state is implicit.

---

## 11. Security review

| Control | Implementation |
|---|---|
| Provider key server-only | `src/config/management.ts` reads `POST_FOR_ME_API_KEY` — no `NEXT_PUBLIC_` prefix; startup validation; provider client is server-module-only |
| Ownership on every resource | Every service method takes `userId` and filters by it; routes never accept a user id from the body |
| Backend entitlement authority | Frontend receives a *rendered* entitlement for display; every mutating route re-evaluates |
| CSRF-safe connection | Signed single-use `jose` state token + server-side re-fetch + `external_id` confirmation |
| Webhook auth | Constant-time secret compare; provider payload treated as untrusted; server-to-server re-verification before persisting |
| Replay protection | `management_webhook_events UNIQUE (provider, provider_event_id)` |
| Payment idempotency | Existing atomic claim + Stripe idempotency key + unique `payment_id` on entitlements |
| No social passwords / tokens | `social_connections` stores ids, display metadata and status only. `access_token`/`refresh_token` from `SocialAccount` responses are **dropped at the provider boundary** and never reach the domain layer, DB, or logs |
| Log redaction | `client.ts` scrubs `Authorization`, any `*token*`, and the webhook secret before logging; a unit test asserts it |
| SSRF | We only ever pass **our own** Spaces URLs as media; no user-supplied URL is forwarded |
| Rate limiting | Per-user, per-route in-process limiter on `connect` and `publications` (mirrors the existing in-process throttle idiom) |
| Encryption at rest | Managed Postgres provides it; we additionally store no secrets |
| Audit | `management_audit_events` for every event in the brief's list |

---

## 12. Phased implementation plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Foundations** | `config/management.ts` (flag + product seed), `calendarMath.ts` + tests, migration `019`, domain models/enums, repository interfaces + Postgres impls + registry wiring | `npm test` green; migration applies twice cleanly |
| **1 — Single Transfer, payment, fulfilment** | `payment_intents.purpose`, `ManagementCheckoutService`, `ManagementPurchaseService`, Stripe webhook dispatch, `ManagementTransferService`, `management_jobs`, `/transfers/*` routes, content library page, `TransferToManagementPanel` + nav item | A paid Single Transfer creates exactly one content item; duplicate webhooks are inert; failed fulfilment retries without a second charge |
| **2 — Access passes** | 3/6/12-month products, `ManagementEntitlementService`, extension arithmetic, `/payments` page, purchase history, expiry behaviour (read-only after expiry, nothing deleted) | Overlapping-purchase example produces Mar 31; expired pass blocks new transfers but preserves history |
| **3 — Post for Me connection + single-platform publish** | Provider layer, Quickstart connection flow with state token + account-selection modal, `/connections`, composer for one platform, `POST /api/webhooks/post-for-me`, status mapping | A test account connects, publishes, and the webhook drives the target to `published` |
| **4 — Multi-platform, scheduling, calendar** | Multi-target publications, per-platform caption/title overrides seeded from the existing post kit, `scheduled_at` in UTC with local display, partial-success aggregation, calendar/chronological view, cancel + retry | Partial success maps to `partially_published`; duplicate publish jobs do not double-post |
| **5 — Hardening & optional** | Expiration reminder emails (14/7/1/0 days), refund + revocation handling, admin correction path, White Label switch, metrics | Reminder copy contains no auto-charge implication |

Documentation (`docs/rclipper-management.md`), `.env.example` additions, and the deployment checklist land with Phase 1 and are updated each phase.

---

## 13. Open questions (blocking)

**Q1 — Prices.** The four products need THB amounts. Everything else is designed; the seed migration needs numbers.

**Q2 — Native app purchases (App Store guideline 3.1.1).** Stripe checkout for Management access inside the iOS/Android shells is a store-policy violation. Web-only, mirrored IAP SKUs, or defer?

**Q3 — Payment method.** PromptPay QR only, card Checkout only, or both (as credits top-up offers today)?

**Q4 — Credit wallet vs. direct payment.** Users already hold a THB-denominated credit balance. Should Management purchases be payable from the wallet as well as by card/QR, or strictly a separate one-time payment?

**Q5 — Post for Me project type.** Quickstart (fastest; users see the Post for Me brand at consent) or White Label from the start (requires per-platform app review)?

---

## Sources

- [Post for Me — Developers](https://www.postforme.dev/developers)
- [Post for Me — API reference](https://api.postforme.dev/docs)
- [Post for Me Python SDK (generated from the OpenAPI spec)](https://github.com/DayMoonDevelopment/post-for-me-python)
- [Real-Time Updates with Webhooks](https://www.postforme.dev/resources/real-time-updates-with-webhooks)
- [Handling Account Connection Redirects and Webhooks](https://www.postforme.dev/resources/handling-account-connection-redirects-and-webhooks)
- [Multi-User Applications](https://www.postforme.dev/resources/multi-user-applications)
- [Quickstart vs. White Label Project](https://www.postforme.dev/resources/quickstart-vs-white-label-project)

# RClipper Management

A publishing and management area in the requester dashboard. Videos are
collected — **free** — and then published to the user's **own** social accounts
through a publishing provider (Post for Me).

Design rationale and the full repository survey are in
[`rclipper-management-plan.md`](./rclipper-management-plan.md). This document is
the operational reference.

---

## 1. The core rule

> **Collecting content is free. Publishing is paid.**

| Action | Cost |
|---|---|
| Transfer a completed generation project in | **Free**, and entirely optional |
| Upload your own video | **Free** |
| Preview, organise, edit captions | **Free** |
| Publish to social channels | **Paid** |

Payment sits immediately before a video is submitted to channels, and nowhere
else. A user who never publishes never pays, and a user who never opens
Management keeps the existing download experience exactly as it was.

### Two ways in

1. **Transfer** — a finished RClipper generation project's channel videos are
   copied in. One live item per project; the transfer is idempotent.
2. **Upload** — the user brings any video. This is what lets Management stand on
   its own as a multi-channel publish-and-manage tool, not merely an extension
   of the generator. A user may hold as many uploads as they like.

Both produce the same kind of `management_content_items` row, distinguished only
by `source_type`.

---

## 2. Products

All one-time, all paid with credits (1 credit = ฿1).

| Product code | What it buys | Launch price | List |
|---|---|---|---|
| `management_single_video` | Publishing for **one video, permanently** | **50 credits** | 100 |
| `management_access_3_months` | **Unlimited** publishing for 3 months | **300** | 600 |
| `management_access_6_months` | Unlimited publishing for 6 months | **550** | 1100 |
| `management_access_1_year` | Unlimited publishing for 12 months | **1000** | 2000 |

Launch prices are 50 % of list, switched by
`MANAGEMENT_LAUNCH_DISCOUNT_ACTIVE` in `src/config/management.ts`, mirroring how
`CREDITS_CONFIG.LAUNCH_DISCOUNT_ACTIVE` works for clip pricing.

**The single-video unlock is permanent and is never consumed.** Re-publishing,
adding a channel weeks later, and retrying a failed send all cost nothing more.
There is deliberately no `consumedAt` column. It is checked *before* access
passes, so a user who paid per video keeps publishing that video after any pass
lapses.

There is **no subscription object, no renewal timer, and no code path that can
charge a user again.** When a pass expires, nothing is billed and nothing is
deleted.

---

## 3. Payment model

```
Credits enter the wallet through the EXISTING verified rails
   web / PWA   → Stripe PromptPay QR or Card  → signed webhook → wallet
   iOS         → Apple In-App Purchase        → App Store Server API → wallet
   Android     → Google Play Billing          → Android Publisher API → wallet
                                   |
                                   v
Buying publishing rights = a wallet DEBIT (management_purchase ledger entry)
```

- **No new payment provider, price object, or webhook.** The verification,
  idempotency and settlement work already lives in `PaymentService` and
  `MobileStorePurchaseService`.
- **Store policy is satisfied on every platform**, because in-app money always
  enters through the platform's own billing.
- **The financial source of truth is `credit_transactions`**, the existing
  immutable ledger. `management_purchases` records the spend and points at it.

### Where the money guarantees live

| Guarantee | Mechanism |
|---|---|
| A double-clicked checkout cannot debit twice | `management_purchases.idempotency_key` UNIQUE, derived from (user, product, content) |
| Two windows of access cannot come from one payment | `management_access_passes.purchase_id` UNIQUE |
| A user cannot be charged twice for the same video | `uq_mgmt_publish_ent_live_per_content` partial unique index |
| The debit and the entitlement cannot diverge | Both happen in ONE transaction in `ManagementPurchaseService.purchase()` |
| Concurrent pass purchases stack instead of colliding | `SELECT … FROM credit_wallets … FOR UPDATE` serialises a user's purchases |
| An already-entitled user is never charged | `/api/management/checkout` re-evaluates entitlement first and returns `alreadyEntitled` |

Because the debit and the grant commit together, there is **no "paid but not
granted" state** to recover from.

---

## 4. Access passes: expiry and extension

Windows use **calendar arithmetic**, not 30-day blocks
(`src/lib/management/calendarMath.ts`). Storage is UTC `TIMESTAMPTZ`; conversion
to local time happens in the browser only.

```
extensionStart = later of (now, current effective expiry)
expiresAt      = extensionStart + N calendar months   (day clamped to month length)
```

Worked example:

```
Access currently expires   31 December
3-month pass bought         1 December
New pass row               31 December → 31 March      ✅
NOT                         1 December →  1 March      ❌ (would discard 30 paid days)
```

Each purchase inserts its **own row**; effective access is `MAX(expires_at)`
across active, non-revoked passes.

Edge cases covered by tests: 31 Jan + 1 month → 28/29 Feb; 29 Feb + 12 months →
28 Feb; year rollover; DST-adjacent instants.

### After a pass expires

| Still works | Blocked |
|---|---|
| Viewing and organising all content | Publishing new content… |
| Transferring new projects in (free) | …unless that video has its own permanent unlock |
| Uploading new videos (free) | |
| Payment and publication history | |
| Already-published social posts (untouched) | |

Nothing is deleted, and no external post is ever un-published.

### Scheduled posts and expiry

Entitlement is consumed when a publication is **created**, not when it fires.
`management_publications` snapshots `entitlement_type`, `access_pass_id` and
`publish_entitlement_id`, so a post scheduled while a pass was live still goes
out after the pass lapses. Anything else would silently break a post the user
already paid for.

---

## 5. Media retention

**The record outlives the file.**

- Stored video is kept until `management_content_items.media_expires_at`
  (default **90 days**, `RCLIPPER_MANAGEMENT_MEDIA_RETENTION_DAYS`).
- After purge: `media_deleted_at` is set and the status becomes `media_expired`.
  The record, the publishing history and any purchased unlock all survive.
- **Re-uploading a replacement into an unlocked item costs nothing** — the user
  paid to publish that item, not to store it.
- Media is **held past the window** while a publication is `draft`, `scheduled`
  or `publishing`.

### Two separate retention regimes

| Content | Governed by | Swept by |
|---|---|---|
| Transferred generation media | `uploaded_assets`, pinned via `retention_pinned` | `scripts/retention-sweep.js` — skips a request while its Management window is open or a post is pending |
| Management uploads | `media_expires_at` | The Management purge (`findMediaExpiryCandidates`) |

Management uploads live under the `management_uploads/` prefix, whose key layout
(`management_uploads/{userId}/{contentId}/…`) deliberately differs from the
clip-request layout, and which is **not** in `mediaPrefixes.json`. The clip sweep
therefore never touches them.

> **Ops:** add a bucket lifecycle backstop on `management_uploads/` comfortably
> longer than `RCLIPPER_MANAGEMENT_MEDIA_RETENTION_DAYS`, so the backstop never
> fires before the app-driven purge.

---

## 6. Architecture

```
RClipper video generation              (unchanged)
        │
        ▼
Final channel videos → DistributionReviewPanel      (download path unchanged)
        │
        ├─ [free, optional] Transfer ──┐
                                       ├──► management_content_items
User's own file ── [free] Upload ──────┘            │
                                                    ▼
                                        ManagementEntitlementService
                                          · checkTransferEligibility  (free)
                                          · evaluateForPublish        (PAID GATE)
                                                    │ (no entitlement)
                                                    ▼
                                        ManagementPurchaseService
                                          credit debit + grant, one txn
                                                    │
                                                    ▼
                                        SocialPublishingProvider
                                                    │
                                                    ▼
                                             Post for Me API
                                          ├── Facebook  ├── Instagram
                                          ├── TikTok    └── YouTube
```

Layering follows the existing convention: `domain/` →
`repositories/interfaces` → `repositories/postgres` → `repositories/index.ts`
(the only place implementations are constructed) → `services/` → `app/api` →
`features/`.

---

## 7. Database

Migration: **`src/db/migrations/019_rclipper_management.sql`** (idempotent).

```bash
node scripts/apply-migration.js src/db/migrations/019_rclipper_management.sql
```

Tables: `management_products`, `management_content_items`,
`management_purchases`, `management_access_passes`,
`management_publish_entitlements`, `management_content_assets`,
`social_connections`, `management_publications`,
`management_publication_targets`, `management_jobs`,
`management_webhook_events`, `management_audit_events`.

It also:

- extends the `credit_transactions` type CHECK with `management_purchase` and
  `management_refund`;
- adds `uploaded_assets.retention_pinned`;
- seeds/re-syncs the four products (`ON CONFLICT (code) DO UPDATE`);
- drops an empty `management_single_transfer_entitlements` table if an earlier
  draft of this migration was applied, and **refuses to run** if that table has
  rows — so it can never silently destroy data.

Key nullability choices that make uploads possible:

- `management_content_items.source_generation_id` is **nullable**, guarded by a
  CHECK that a transfer names its source and an upload does not.
- `management_content_assets.source_video_id` is **nullable**: an upload has no
  clip request and therefore no `uploaded_assets` row, so `storage_key` is the
  identity.

> **Migration folders.** The repository has two (`migrations/` and
> `src/db/migrations/`) with independently numbered files. `src/db/migrations/`
> is the active one for feature work.

---

## 8. API

| Method | Path | Cost |
|---|---|---|
| `GET` | `/api/management/products` | — |
| `GET` | `/api/management/entitlement?contentId=&sourceRequestId=` | — |
| `GET` | `/api/management/content` | — |
| `POST` | `/api/management/transfers` | **Free** |
| `GET` `POST` | `/api/management/uploads` | **Free** (returns a presigned PUT) |
| `POST` | `/api/management/uploads/[contentId]/complete` | **Free** |
| `POST` | `/api/management/checkout` | **The only paid endpoint** |
| `GET` `POST` | `/api/management/social-accounts` | **Free** (list / start a connection) |
| `GET` | `/api/management/social-accounts/callback` | **Free** (provider redirect) |
| `POST` `DELETE` | `/api/management/social-accounts/[connectionId]` | **Free** (refresh / disconnect) |
| `POST` | `/api/webhooks/post-for-me` | provider → us |

Uploads go **directly from the browser to Spaces** via a presigned PUT, so large
video files never pass through the web server. The completion step verifies the
object exists with a HEAD and that its key belongs to that upload — a client
claiming "upload done" is not evidence that it is.

> **Cleanup needed:** `src/app/api/management/transfers/checkout/` and
> `src/app/api/management/transfers/[sourceRequestId]/` are 410 stubs left behind
> because the sandbox could not unlink files on the mounted volume. Delete both
> folders.

---

## 9. Post for Me integration

Verified against the current API (citations in the plan document).

- Base URL `https://api.postforme.dev`, auth `Authorization: Bearer <key>`.
- `POST /v1/social-accounts/auth-url`, `GET /v1/social-accounts`,
  `POST /v1/social-accounts/{id}/disconnect`, `POST /v1/media/create-upload-url`,
  `POST /v1/social-posts`, `GET /v1/social-post-results`, `POST /v1/webhooks`.
- **Webhook auth is a shared secret**, header `Post-For-Me-Webhook-Secret` — not
  an HMAC. Compare in constant time and treat the payload as untrusted: re-fetch
  from the API before persisting anything meaningful.
- Must return `2XX` within **1 second**; retries ~8 times over 24 h; duplicates
  are expected, so handling must be idempotent (`management_webhook_events`).
- Multi-tenancy uses `external_id` = our `users.id`. Accounts are globally unique
  per project, so our own `social_connections` mapping enforces ownership.
- Connection failures are visible **only** on the OAuth redirect
  (`isSuccess`, `error`) — no webhook fires for them.

**Tokens are never stored.** `access_token` / `refresh_token` are dropped at the
provider boundary (`post-for-me/mappings.ts`) and never reach the domain layer,
the database, or a log line. A test asserts it.

### Connecting an account — why it is more than a redirect

The provider returns the user to our callback with `accountIds` **in the query
string and no proof of identity**. Taken at face value, anyone could hit that URL
with someone else's account id. Three independent defences, all required:

1. A signed, single-use, 15-minute **state token** (JWT via `jose`, signed with
   `NEXTAUTH_SECRET`) bound to `{userId, connectionId, platform}`. Only its
   SHA-256 hash is stored, so a database leak yields nothing replayable, and the
   row is cleared on use.
2. Every claimed account is **re-fetched server-to-server**. The query string is
   a hint, never data.
3. The re-fetched account's `external_id` must equal the session user's id.

Plus `upsertConnected` refuses to move an account that already belongs to a
different RClipper user — otherwise reconnecting a shared Page would silently
transfer another customer's publishing rights.

### Registering the webhook (ops, one-time per environment)

Webhooks can only be created **through the API** — there is no dashboard UI.

```bash
curl -X POST https://api.postforme.dev/v1/webhooks \
  -H "Authorization: Bearer $POST_FOR_ME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-domain>/api/webhooks/post-for-me",
    "event_types": [
      "social.post.result.created",
      "social.post.updated",
      "social.account.updated"
    ]
  }'
```

The response contains a `secret` — put it in `POST_FOR_ME_WEBHOOK_SECRET`. You
cannot create two webhooks with the same URL, so use a distinct domain per
environment.

---

## 10. Environment variables

See the `RClipper Management` and `Post for Me` blocks in `.env.example`.
`RCLIPPER_MANAGEMENT_ENABLED` defaults to **off**.

The flag is evaluated **server-side on every read** (`isManagementEnabledFor`),
never in the browser. A disabled feature returns **404**, not 403 — an off
feature should be indistinguishable from one that does not exist.

---

## 11. Local development

```bash
node scripts/apply-migration.js src/db/migrations/019_rclipper_management.sql
echo 'RCLIPPER_MANAGEMENT_ENABLED=true' >> .env.local
npm run dev
```

Then: sign in as a Requester, open a **completed** request, scroll to
*"Manage and publish your videos"*, and transfer — no credits needed. Credits are
only required at the publish step.

---

## 12. Deployment checklist

1. Apply migration 019.
2. Verify the four rows in `management_products` and their prices.
3. Add the `management_uploads/` bucket lifecycle backstop (§5).
4. Confirm `RCLIPPER_MANAGEMENT_ENABLED=false` initially.
5. Deploy; confirm the dashboard is unchanged for all users.
6. Enable for a small allowlist (`RCLIPPER_MANAGEMENT_ALLOWED_EMAILS`).
7. Run one transfer (free), one upload (free), and one paid publish; check
   `management_audit_events`.
8. Run `scripts/retention-sweep.js --dry-run` and confirm transferred projects
   are reported as *pinned/skipped*.
9. Widen the rollout percentage.

### Rollback

Set `RCLIPPER_MANAGEMENT_ENABLED=false`. The nav item and every route disappear
immediately; no data is lost. Migration 019 is additive — the only changes to
existing tables are a widened CHECK constraint and a defaulted boolean column —
so it does not need reverting to run the previous release.

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `product "…" is not configured in the database` | Migration 019 not applied | Apply it |
| 402 with `needTopup` at publish | Wallet short | Top up credits (existing flow) |
| Transfer button asks for payment | Stale build — transfers are free | Redeploy |
| `reason: "media_expired"` at publish | The stored file passed its window | Upload a replacement — the unlock is permanent, so this costs nothing |
| Upload returns 422 `unsupported_type` | Not one of the accepted containers | See `MANAGEMENT_UPLOAD_MIME_TYPES` |
| Upload completes but item stays `uploading` | The confirm call never ran, or the HEAD failed | Re-call `/uploads/[contentId]/complete` |
| Nav item missing | Flag off, or user outside the rollout | Check `RCLIPPER_MANAGEMENT_ENABLED` and the allowlists |
| Transferred project's media disappeared early | Pin not applied | Check `media_expires_at` and that the sweep runs the patched script |

---

## 14. Status

**Implemented:** products and pricing, feature flag, calendar arithmetic,
migration 019, repositories, transfer eligibility (free), publish entitlement
(paid), credit purchase with atomic grant, free transfer, user uploads with
presigned direct-to-Spaces PUT, media retention windows and the retention pin,
the API routes in §8, the dashboard nav item and overview page, the transfer
panel on the final distribution step, **the provider abstraction and its Post
for Me adapter** (accounts, media, posts, webhook verification, error
classification, log redaction), **social account connection** with the
three-layer ownership defence above, the connections page, and the webhook
intake endpoint.

**Not yet implemented:**

- The **composer** — selecting a video and accounts, per-platform captions, and
  the pay-to-publish step that calls `/api/management/checkout`. Until it
  exists the paid gate is reachable only via the API.
- The **job runner** that drains `management_jobs`. The webhook endpoint records
  events and enqueues work correctly, but nothing consumes the queue yet, so
  publication statuses will not update on their own.
- Publication creation and per-destination status tracking, the calendar view,
  the media-purge job, and expiry reminder emails.

The provider layer is complete and tested, so the composer is now mostly wiring
rather than new integration work.

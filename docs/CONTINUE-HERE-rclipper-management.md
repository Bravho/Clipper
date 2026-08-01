# CONTINUE HERE — RClipper Management

Handoff for a fresh session. Written 2026-07-29.

Read this first, then `docs/rclipper-management.md` (operational reference) and
`docs/rclipper-management-plan.md` (design rationale + the verified Post for Me
API research — its header notes which parts were superseded).

---

## 1. What RClipper Management is

A publishing area in the requester dashboard (`/dashboard/management`). Videos
are collected **free** and published to the user's **own** social accounts
through Post for Me.

**The one rule everything else follows:**

> **Collecting content is free. Publishing is paid.**

| Action | Cost |
|---|---|
| Transfer a completed generation project in | **Free**, optional |
| Upload your own video | **Free** |
| Connect a social account | **Free** |
| Organise, preview, edit captions | **Free** |
| **Publish to social channels** | **Paid** |

Payment is a **credit wallet debit**. Credits reach the wallet only through
already-verified rails — Stripe on web, Apple IAP / Google Play Billing in the
Capacitor shells — so Management adds **no payment provider and no payment
webhook**, and stays store-policy compliant on iOS and Android.

### Products (all one-time, nothing renews)

| Code | Buys | Launch | List |
|---|---|---|---|
| `management_single_video` | Publishing for ONE video, **permanently** | 50 credits | 100 |
| `management_access_3_months` | **Unlimited** publishing, 3 months | 300 | 600 |
| `management_access_6_months` | Unlimited, 6 months | 550 | 1100 |
| `management_access_1_year` | Unlimited, 12 months | 1000 | 2000 |

1 credit = ฿1. Launch = 50 % of list, toggled by
`MANAGEMENT_LAUNCH_DISCOUNT_ACTIVE` in `src/config/management.ts`.

---

## 2. Invariants — do not break these

These are load-bearing. Several are enforced by tests that will fail loudly.

1. **No subscriptions, ever.** No subscription object, no renewal timer, no
   column that could drive an automatic charge. `tests/i18n/managementWording.test.ts`
   fails the build if "subscribe", "renews automatically", "cancel anytime" or
   their Thai/Vietnamese equivalents appear in any `management.*` string.
2. **The single-video unlock is permanent and never consumed.** No `consumedAt`.
   Re-publishing, adding a channel later, and retrying a failure all cost
   nothing. It is checked **before** access passes, so it outlives any pass.
3. **Entitlement is consumed when a publication is CREATED, not when it fires.**
   `management_publications` snapshots `entitlement_type`, `access_pass_id`,
   `publish_entitlement_id`. A post scheduled while a pass was live must still
   go out after the pass lapses.
4. **Expiry never deletes anything** and never un-publishes an external post. It
   blocks only NEW publications.
5. **No social tokens are ever stored.** The provider returns `access_token` /
   `refresh_token`; `post-for-me/mappings.ts` drops them and strips
   credential-shaped keys from metadata. A test serialises the mapped object and
   asserts the secrets are absent.
6. **The client sends a product CODE and nothing else.** No amount, currency,
   duration or entitlement type is in any request schema — not "ignored", absent.
7. **The frontend is never the authority.** Every mutating route re-evaluates
   entitlement server-side.
8. **Media is referenced, never duplicated. Signed URLs are never persisted** —
   they expire in an hour and a scheduled post may fire weeks later, so the URL
   is minted at send time.
9. **An unrecognised provider error is PERMANENT, not retryable.** Retrying
   something we do not understand can repost a video or look like spam.
10. **`processed` ≠ published.** It means the provider finished working through
    the post. Success is per-destination, from the results.

---

## 3. State of play

### Built and verified (104 tests pass, zero type errors)

- **Config / domain** — `src/config/management.ts` (flag + products + retention,
  all env read via **getters**, see gotcha 4), `src/lib/management/calendarMath.ts`,
  `src/domain/enums/Management*.ts`, `src/domain/models/Management*.ts`,
  `SocialConnection.ts`.
- **Database** — `src/db/migrations/019_rclipper_management.sql`, **applied to
  the live database on 2026-07-29**.
- **Repositories** — `IManagementRepositories.ts`,
  `PostgresManagementRepositories.ts`, `PostgresSocialConnectionRepository.ts`,
  wired in `src/repositories/index.ts`.
- **Services** — `services/management/`: Audit, Entitlement, Purchase, Transfer,
  Upload, Connection.
- **Provider layer** — `services/social-publishing/`: `types.ts`, `errors.ts`,
  `provider.ts`, `index.ts`, and `post-for-me/{client,mappings,accounts,media,posts,webhooks}.ts`.
- **API** — all 13 routes under `src/app/api/management/` plus
  `src/app/api/webhooks/post-for-me/route.ts`.
- **UI** — `DashboardShell.tsx` (nav), server dashboard layout,
  `/dashboard/management` (overview), `/dashboard/management/connections`,
  `TransferToManagementPanel`, `ConnectionsManager`, `buildManagementView`.
- **Ops** — `scripts/retention-sweep.js` Management pin, `.env.example` block,
  i18n in th/en/vi.
- **Tests** — `tests/lib/managementCalendarMath.test.ts`,
  `tests/services/ManagementEntitlement.test.ts`,
  `tests/services/SocialPublishing.test.ts`,
  `tests/i18n/managementWording.test.ts`.

### NOT built — the actual work queue

1. **The composer.** Selecting a video + accounts, per-platform captions, and the
   **pay-to-publish** step calling `POST /api/management/checkout`. Until this
   exists the paid gate is only reachable via the API, so *no user can currently
   spend money*.
2. **`ManagementPublicationService`** — create `management_publications` +
   `management_publication_targets`, call `provider.createPost`, map results
   back. Targets must be written **before** the provider call so a crash is
   auditable and retryable.
3. **The job runner.** `management_jobs` is written to but **nothing drains it**.
   The webhook records events and enqueues correctly, then nothing happens.
   Follow the render-queue claim pattern (migration 010, `config/renderQueue.ts`,
   `scripts/render-worker.ts`): claim → heartbeat → stale reclaim.
4. **Missing pages that are already linked → these 404 today:**
   - `/dashboard/management/content` and `/content/[id]` — linked from the
     overview page **and** from `TransferToManagementPanel`'s "Open in RClipper
     Management" button.
   - `/dashboard/management/payments` — linked from the overview.
   - `/dashboard/management/calendar` — in `ROUTES`, not yet linked.
5. Media-purge job (`findMediaExpiryCandidates` exists, no caller), expiry
   reminder emails, refund/revocation admin path.

### Cleanup owed

- **Delete `src/app/api/management/transfers/checkout/` and
  `src/app/api/management/transfers/[sourceRequestId]/`.** Both are 410 stubs
  left because the sandbox cannot unlink files on the mounted volume.
- **Register the Post for Me webhook** (API only, no dashboard UI) and put the
  returned `secret` in `POST_FOR_ME_WEBHOOK_SECRET` — see §9 of
  `docs/rclipper-management.md`. Without it every delivery is rejected 401.
- **`npm run lint` and `npm run build` have never been run** against this work —
  see gotcha 1.
- Add a bucket lifecycle backstop on the `management_uploads/` prefix, longer
  than `RCLIPPER_MANAGEMENT_MEDIA_RETENTION_DAYS` (90).

---

## 4. Gotchas that will waste your time

**1. The mounted volume is ~6 MB/s. `tsc`, `jest`, `eslint` and `next build` all
exceed the 45 s sandbox limit.** Background processes do not survive the call
that starts them. Verify in a local scratch copy instead:

```bash
mkdir -p /tmp/verify && cd /sessions/<id>/mnt/clipper_agent
cp -r src tests tsconfig.json jest.config.js /tmp/verify/     # ~15 s
cd /tmp/verify
npm install typescript@5 jest@29 ts-jest@29 @types/jest @types/node pg @types/pg \
            next@14 react@18 react-dom@18 @types/react @types/react-dom \
            next-auth@4 zod@3 clsx@2
# npm install often needs 2 attempts — the first is killed at 45 s but warms the cache
npx jest tests/services/ManagementEntitlement.test.ts        # ~1 s once installed
```

For typechecking write a **scoped** `tsconfig` that `extends` the real one and
includes only the files under test **plus `src/types/**/*.d.ts`** (the NextAuth
augmentation — without it you get bogus "Property 'role' does not exist on
session.user"). Stub heavy optional deps in a `stubs.d.ts`
(`declare module "bcryptjs";` etc.). Keep the include set small or tsc times out.
Errors reported in `montageService`, `remotionService`, `spaces.ts`,
`thumbnails.ts` or `VideoGenerationService` are artefacts of the reduced
dependency set — **not** real breakage. Do not report them as pre-existing bugs.

**2. `git status` shows ~90 files modified. That is CRLF noise from the mount,
not real changes.** Check `git diff <file> | head` before believing a file was
touched.

**3. Phase 2B id columns may be `uuid` OR `text`.** `migrations/002` declares
`clip_requests.id TEXT`; the live database has **uuid**. Migration 006 says so
outright and inspects `information_schema`. Migration 019 follows that: the two
FK columns are added in type-aware `DO` blocks. **Do not "simplify" them back to
a literal type** — it will fail with "incompatible types: text and uuid".

**4. Read env through getters, never module-scope constants.** Both
`MANAGEMENT_CONFIG` and `POST_FOR_ME_CONFIG` use getters. A captured constant is
frozen at import time, which makes it untestable *and* — if the module loads
before `scripts/bootstrapEnv.ts` populates the environment — permanently empty,
presenting as "the provider rejects everything".

**5. No local Postgres in the sandbox (no root).** Validate SQL with
`pip install pglast --break-system-packages` then
`pglast.parse_sql(open(file).read())` — that is libpg_query, the same parser
Postgres uses. It proves syntax, not execution; `DO` block bodies are PL/pgSQL
and only validate at runtime.

---

## 5. Repository conventions to follow

- Next.js 14 App Router, TypeScript, Tailwind, **raw `pg` (no ORM)**, Zod,
  NextAuth v4, Jest + ts-jest.
- Layering: `domain/` → `repositories/interfaces` → `repositories/postgres` →
  **`repositories/index.ts` is the only place implementations are constructed**
  → `services/` → `app/api` → `features/`.
- New migrations go in **`src/db/migrations/`** (next free number: **020**),
  applied with `node scripts/apply-migration.js <file>`. Idempotent, with
  `IF NOT EXISTS`.
- API routes return `NextResponse.json({ error: "…" }, { status })`; services
  throw `Error`, routes map to status codes. Log with a bracketed prefix:
  `[POST /api/…]`.
- Tests construct services with **stubbed/fresh repositories**, never the global
  registry.
- i18n: add every key to **all three** catalogues (`th`, `en`, `vi`) in
  `src/i18n/messages.ts` — `Catalog` is `Record<keyof typeof th, string>`, so a
  missing key is a type error.
- `next.config.js` and `jest.config.js` must stay `.js`.

---

## 6. Suggested next task — the composer

Recommended because it unblocks revenue: nobody can pay today.

1. `ManagementPublicationService.create()` — validate ownership of the content
   item and every selected connection, re-check `evaluateForPublish`, write the
   publication + one target per account **before** calling the provider, mint a
   fresh signed URL for the media at send time, call
   `provider.createPost({ externalId: publication.id })`, store
   `provider_post_id`, then aggregate with `aggregatePublicationStatus()` (already
   written and tested in `domain/models/ManagementPublication.ts`).
2. Composer UI at `/dashboard/management/content/[id]` — video variant picker,
   account multi-select, common caption seeded from the existing
   `ChannelPublishingDraft[]` post kit, per-platform overrides, publish-now vs
   schedule (store UTC, display local), and the **pay-to-publish** gate that
   surfaces the package picker when `evaluateForPublish` returns
   `payment_required`.
3. Build the missing `content` and `payments` pages at the same time so the
   existing links stop 404-ing.
4. Then the job runner, so statuses actually move.

---

## 7. Paste-ready opening prompt for the new session

> Continue work on **RClipper Management** in `D:\coding\clipper_agent`.
>
> Read `docs/CONTINUE-HERE-rclipper-management.md` first — it has the current
> state, the invariants, and the sandbox gotchas (the mounted volume is too slow
> to run `tsc`/`jest` directly; use the `/tmp/verify` recipe in §4). Then skim
> `docs/rclipper-management.md`.
>
> Migration 019 is already applied to the live database. Phases 0–3 are built and
> tested: free transfer, free uploads, credit-based publish entitlement, the
> Post for Me provider layer, and social account connections.
>
> **Next: build the composer** (§6). Specifically:
> 1. `ManagementPublicationService` — create publication + targets before calling
>    the provider, mint the signed media URL at send time, aggregate status with
>    the existing `aggregatePublicationStatus()`.
> 2. The composer UI at `/dashboard/management/content/[id]`, including the
>    pay-to-publish gate calling `POST /api/management/checkout`.
> 3. The missing `/dashboard/management/content` and `/payments` pages — they are
>    already linked from the overview and currently 404.
>
> Hold to the invariants in §2 — especially: collecting is free and only
> publishing is paid, the single-video unlock is permanent and never consumed,
> entitlement is consumed when a publication is created (not when it fires), and
> no social tokens are ever stored.
>
> Ask me before making product decisions I have not already settled.

# CONTINUE HERE — RClipper Management (v2)

Handoff written 2026-07-30. Supersedes the state section of
`docs/CONTINUE-HERE-rclipper-management.md` (v1) — read v1 first for the original
architecture, the Post for Me research, and the base invariants, then this file
for everything that changed since.

The number-one symptom right now: clicking **"อยู่ใน RClipper Management แล้ว — เปิด →"**
(or "View all" on the overview) gives a **404**, because the pages under
`/dashboard/management/content` were never built. That is the composer UI, and
it is the main remaining user-facing gap.

---

## 1. Locked product decisions (do not silently change)

- **Collecting is free, publishing is paid.** Transfer and upload cost nothing;
  money is required only to publish.
- **Entry product `management_single_video` is now a CONSUMABLE, EXPIRING
  BUNDLE — this REVERSES v1's "permanent, never-consumed single-video unlock".**
  - 50 credits (฿50) launch / 100 list → **4 upload tokens**, valid **30 days**
    from purchase.
  - **One token = one video published to ONE channel** (one publication target).
    The same 9:16 file to 3 channels spends **3** tokens. Different aspect ratios
    of the same content are **different** videos.
  - After 4 tokens are spent, buy again. Unused tokens expire at 30 days.
  - The 30-day window is NEITHER how long a post stays up NOR the media-storage
    window (still 90 days) — only the window to spend the allowance.
- **Access passes (3/6/12-month) unchanged** = unlimited publishing while active,
  no token counting.
- **Per-video transfer:** each generated ratio export becomes its OWN
  `management_content_items` row (one item = one video). "Transfer all" transfers
  each one.
- **Feature flag defaults ON** (`RCLIPPER_MANAGEMENT_ENABLED !== "false"`).
- Still holding from v1: no social tokens stored; entitlement consumed when a
  publication is CREATED (not when it fires); frontend never the authority;
  signed media URLs minted at send time, never persisted; provider `createPost`
  is never retried; an unrecognised provider error is PERMANENT.

---

## 2. Built and verified this session (full `next build` NOT run — see §6)

- **Composer backend** — `ManagementPublicationService.create()` (validates
  ownership + connections + per-target aspect ratio, re-checks entitlement,
  writes publication+targets before the provider call, groups targets by video
  variant into one `createPost` per group, mints signed URL at send time,
  aggregates status, enqueues a reconcile job). Repos:
  `PostgresManagementPublicationRepository`, `PostgresManagementJobRepository`
  (claim/heartbeat/reclaim). API: `POST`/`GET /api/management/publications`.
  Aspect-ratio rules: `src/config/managementPublishing.ts`. Tests:
  `tests/services/ManagementPublication.test.ts`,
  `tests/config/managementPublishing.test.ts`.
- **Feature flag defaults ON** — `src/config/management.ts` `enabled` getter.
- **Transfer eligibility bug fixed** — `COMPLETED_STEPS` in
  `ManagementEntitlementService` now includes `AwaitingDistributionReview` (the
  download step, where the transfer panel appears). Previously it showed "video
  not ready" on the very step it renders on.
- **Bundle pricing — config + i18n only** — `management_single_video` now carries
  `uploadAllowance: 4`, `accessWindowDays: 30`; helper `managementBundleTerms()`;
  th/en/vi product strings updated. Prices unchanged (50/100).
- **Per-video transfer — full path** — repo `createOrGetTransferredVideo` /
  `findBySourceVideo` / `findAllBySource`; `ManagementTransferService.transferVideo`
  + `transferAll`; `POST /api/management/transfers` takes `videoAssetId` (one) or
  transfers all when omitted; `buildDistributionTransferView` server helper;
  `DistributionReviewPanel` renders a per-video
  "นำวีดิโอเข้าสู่การบริหารช่องทางสื่อออนไลน์" button under each channel's copy
  button and a "...ทั้งหมด" transfer-all button above the feedback control, BOTH
  gated on `!downloadLocked && !mediaExpired && managementEnabled`. Tests:
  `tests/services/ManagementTransfer.test.ts`. The old whole-project
  `TransferToManagementPanel` + `buildManagementView` are removed from the request
  page (files still exist, now DEAD — delete them).

Verification done: unit tests pass under the `/tmp/verify` recipe (§6); both
migrations parse under `pglast`; changed backend files type-check clean with a
scoped `tsconfig`. React/Next files (`DistributionReviewPanel`, the request page)
were NOT type-checked or built here.

---

## 3. Migrations — 019, 020, 021 all APPLIED to the live DB (020 + 021 on 2026-07-30)

No migration action is outstanding. New schema work starts at **022**.

What 020 + 021 changed (for reference / reconciliation):

- **020** added `upload_allowance`/`access_window_days` to `management_products`
  (reseeded the entry product to 4/30), created `management_upload_bundles`
  (with storage-level CHECKs so tokens cannot over-spend or go negative), and added
  `upload_bundle_id` to `management_publication_targets`.
- **021** added `source_asset_id` to `management_content_items` and replaced
  `uq_mgmt_content_per_source` (one-per-project) with
  `uq_mgmt_content_per_source_video` (one-per-video).

Optional sanity check next session: confirm `management_products` shows
`upload_allowance = 4`, `access_window_days = 30` for `management_single_video`,
and that `management_upload_bundles` exists.

---

## 4. Remaining work — the plan

**A. Missing pages (fixes the 404).**
  - `/dashboard/management/content` — the library list (API `GET /api/management/content`
    already exists).
  - `/dashboard/management/content/[id]` — the **composer**: video/variant picker,
    connected-account multi-select, per-platform captions seeded from the
    `ChannelPublishingDraft[]` post kit, publish-now vs schedule (store UTC,
    display local), and the **pay-to-publish gate** that calls
    `POST /api/management/checkout` when entitlement is missing, then
    `POST /api/management/publications`.
  - `/dashboard/management/payments` — package picker + purchase history.
  - `/dashboard/management/calendar` — in `ROUTES`, optional.

**B. Bundle pricing backend (unblocks revenue — nobody can pay the bundle yet).**
  - `ManagementUploadBundle` domain model + `IManagementUploadBundleRepository`
    (create; `findSpendable(userId)` = active, in-window, remaining>0, FIFO;
    `consume(bundleId, n)` decrementing `remaining` atomically with a guarded
    `UPDATE ... WHERE remaining >= n`; expire). Postgres impl + wire in
    `src/repositories/index.ts`.
  - `ManagementPurchaseService` — for the entry product, grant a **bundle**
    (`total_allowance`/`expires_at = now + window`) in the same txn as the debit,
    instead of a permanent `management_publish_entitlements` row.
  - `ManagementEntitlementService.evaluateForPublish` — becomes token-based:
    active pass ⇒ unlimited; else the user must have **≥ N remaining tokens**
    across non-expired bundles, where **N = number of targets** in the publish.
    Add a count-aware entry point (the publish is per-target now, not per-content).
  - `ManagementPublicationService.create` — after writing targets, **consume N
    tokens atomically** (one per target), stamping each target's
    `upload_bundle_id`. A pass consumes nothing.
  - **Rewrite** the v1 "permanent / never-consumed" tests to the consumable model.

**C. Job runner** — drain `management_jobs` (reconcile publication results via the
  provider), following the render-queue claim pattern (migration 010,
  `scripts/render-worker.ts`). The repo is built; nothing consumes the queue yet.

**D. Cleanup / ops.**
  - Delete dead files: `src/features/management/components/TransferToManagementPanel.tsx`,
    `src/features/management/server/buildManagementView.ts`.
  - Delete the two 410 stub folders (`api/management/transfers/checkout/`,
    `.../[sourceRequestId]/`) — from v1.
  - Register the Post for Me webhook and set `POST_FOR_ME_WEBHOOK_SECRET` (v1 §9).
  - Bucket lifecycle backstop on `management_uploads/` longer than 90 days.

---

## 5. Recommended order for the next session

Migrations 019/020/021 are already applied (§3), so start straight on code:

1. **Bundle pricing backend (B)** — so publishing can actually charge.
2. **Content list + composer page (A + the composer in C)** — fixes the 404 and
   gives users the publish UI + pay-to-publish gate.
3. **Payments page** + package picker.
4. **Job runner** so statuses move.
5. **Cleanup (D).**

Ask before changing any locked decision in §1.

---

## 6. Sandbox gotchas (verification is constrained)

- **The mounted volume is too slow to `npm install` next/react**, so `tsc`,
  `jest`, `next build`, `eslint` cannot run against the repo directly (they exceed
  the 45s sandbox limit). Recipe that works:
  - Copy `src tests tsconfig.json` into `/tmp/verify` (local disk).
  - Install ONLY `typescript jest ts-jest @types/jest @types/node pg` (needs 2–3
    passes; `--prefer-offline` finalises once cached). next/react are NOT needed
    to RUN the unit tests.
  - Use a transpile-only `jest.min.js` (`isolatedModules: true`) — this erases
    type-only imports so next/react are never loaded at runtime.
  - For type-checking backend files, a scoped `tsconfig` that `extends` the real
    one + a `stubs.d.ts` declaring `pg` and `@aws-sdk/*`. React/Next files can't be
    type-checked here.
  - **`npm run build` on the dev machine is the real gate** before merge.
- Validate SQL with `pip install pglast --break-system-packages` then
  `pglast.parse_sql(open(f).read())`.
- `git status` shows CRLF noise, not real changes.
- Read env through getters, never module-scope constants.
- Phase-2B id columns may be uuid OR text — `source_asset_id` is TEXT with NO FK
  for exactly this reason.

---

## 7. Paste-ready opening prompt for the new session

> Continue RClipper Management in `D:\coding\clipper_agent`.
>
> Read `docs/CONTINUE-HERE-rclipper-management-v2.md` first (then v1 for base
> architecture). It has the locked product decisions, what's built, and the
> sandbox gotchas (the mount is too slow to run `tsc`/`jest`/`next build` — use
> the `/tmp/verify` recipe in §6; validate SQL with `pglast`).
>
> Migrations 019, 020, and 021 are ALREADY APPLIED to the live DB — no migration
> action needed; new schema work starts at 022.
>
> Current 404 cause: the pages under `/dashboard/management/content` were never
> built.
>
> Do the work in this order unless I say otherwise:
> 1. Build the **bundle pricing backend**: `ManagementUploadBundle` model + repo
>    (create / findSpendable FIFO / atomic consume / expire), have
>    `ManagementPurchaseService` grant a 4-token/30-day bundle for
>    `management_single_video` instead of a permanent unlock, make
>    `evaluateForPublish` token-based (N = number of targets; active pass =
>    unlimited), and have `ManagementPublicationService.create` consume N tokens
>    atomically stamping `upload_bundle_id` per target. Rewrite the old
>    permanent/never-consumed tests.
> 2. Build the missing pages: `/dashboard/management/content` (list) and
>    `/dashboard/management/content/[id]` (the composer with the pay-to-publish
>    gate calling `/api/management/checkout` then `/api/management/publications`),
>    plus `/dashboard/management/payments`.
> 3. Then the job runner, then cleanup (delete the dead
>    `TransferToManagementPanel.tsx` + `buildManagementView.ts` and the two 410
>    transfer stub folders; register the Post for Me webhook).
>
> Hold the locked decisions in §1 — especially: the entry product is a consumable
> 4-upload / 30-day bundle (one token per video-to-one-channel), access passes are
> unlimited, collecting is free and only publishing is paid, and each generated
> video is its own per-video Management item. Ask me before changing any of them.

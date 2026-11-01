# FINAL REPORT — Phase 1 follow-up

All verification used isolated mocks or the offline preload in `scripts/offline-verification.cjs`. No dev server, migration, cleanup command, real database connection, paid API, or external network request was run. Secret-file reads are blocked by the preload; no secret files were inspected or edited.

## Review findings 1–18

| Item | Implementation |
|---|---|
| 1 | Required JWT expiry/claims and HS256, fail-closed revocation lookup, live item/status/version/type and asset binding. Status replies issue private review links. The server-validated page supports script/storyboard edits, revision saves, media playback, and approval. Every action revalidates the token. |
| 2 | Postgres review item/action/rule/outbox, LINE-account/conversation, and package/order/usage implementations are registered in the repository registry. SQL column mismatches in the partial outbox implementation were corrected. No database was contacted. |
| 3 | Persisted package choice, order-linked Payment Link, webhook-confirmed payment wait, brief, storyboard/voice preferences, private image/video download, legal/AI confirmation, request submission and existing pipeline initialization are wired in the webhook. Account mapping creates requester identities. |
| 4 | Human requests and unrecognised text create real review items; an authenticated `/admin/review` queue exposes them. Tests assert queue persistence rather than an escalation boolean. |
| 5 | Postgres maps intake channel, lane, order, external reference, preferences and shop rules. LINE create persists these fields; studio creation retains the previous INSERT. Real submit-route tests cover LINE exemption and studio/web rejection under STUDIO_ONLY. |
| 6 | Preferences are asked and stored. Initial storyboard/script, voice, then styled-video gates hook into LINE pipelines only with the review flag, inside try/catch. Shop-selected gates are excluded from the admin queue. Voice previews are private MP4 containers with script text. Decisions execute from the durable outbox in the render worker. |
| 7 | Mac Mini is main; LINE enqueue uses `mac_mini`. The worker passes RENDER_LANE and records a lane heartbeat. `backup`/`operator_pc` claims LINE tasks only after main staleness or queue-age thresholds. |
| 8 | Lane support defaults off. Disabled INSERT and claim statements are byte-for-byte the statements from 79e1ef4, checked against frozen fixtures. Enabled SQL retains atomic SKIP LOCKED claims. |
| 9 | LINE webhook uploads, requester upload confirmation, thumbnails, TTS, worker rendering and internal asset reads use private ACL/signed URLs. Async storage context scopes output privacy to LINE work. Stored private URLs are refreshed when read. Studio paths retain public URL behavior. |
| 10 | Stripe constructEvent verifies raw bodies. Activation requires paid status, test mode by default, known package, exact amount and THB currency. Payment Link URLs carry order client_reference_id. Both completion and async-payment-success events are supported. |
| 11 | Production decisions use one checked-out transaction for conditional status/version/expiry/render update, action and outbox. Failures roll back; competing decisions report version_conflict. Tests cover competing mock service decisions, actual conditional SQL, and production transaction rollback/commit. Auto decisions use the same decision path. |
| 12 | Two revisions are enforced using conditional request updates; package usage also checks limits under an order-row lock. Review edits/rejections and direct pipeline revision paths consume revisions. Intake, footage probing, voice duration and scene duration enforce the 90-second cap. |
| 13 | The pipeline's real persistence path applies fixed shop copy and validates licensed music selection. Canonical menu names/prices override generated copy; unsupported promotional claims are removed before approved promotions are inserted. A real pipeline test checks copy, music and duration enforcement. |
| 14 | Webhook payloads/IDs are persisted before processing. Completed duplicates are skipped; outstanding leases retry rather than being acknowledged as completed. Processing/persistence failures return non-2xx. Tests cover missing tables, duplicates and persistence ordering. |
| 15 | Decisions reject wall-clock expiry and queued/rendering/failed renders; conditional SQL rechecks expiry and approval render readiness. |
| 16 | RuleEngine applies type confidence thresholds before trusted auto-approval. The production rule repo reads the default rules seeded by migration 048. |
| 17 | Replaced copied predicates/constants with real route, service, S3-command, cleanup-service and Postgres-query tests. Added intake/escalation, preview-token, transaction, webhook durability, pipeline policy and notification-policy coverage. |
| 18 | Production Stripe verification exclusively uses the installed Stripe SDK; route tests sign fixture events with the SDK and exercise activation/rejection. The legacy manual verifier remains for compatibility tests, outside the production route. |

## Verification

- Initial handoff: `npx tsc --noEmit` passed; Jest 151 suites / 1,682 tests passed; guarded build passed.
- Final typecheck: passed.
- Final Jest: 159 suites and 1,667 tests passed (exit 0). Final guarded `npm run build`: passed (exit 0), 84 static pages generated. Logs are `offline-final-jest.log` and `offline-final-build.log` at the repository root.
- Weak tests were removed/replaced, so a lower total test count is intentional.
- One intermediate full run found a studio voice-remake regression introduced during this round. It was fixed by restricting the revision check to LINE; the affected suite and subsequent full suite passed.
- One intermediate build failed loading Sharp with Windows `ERR_DLOPEN_FAILED: The paging file is too small`. The offline preload now bounds build worker fan-out; the subsequent build passed. It also prevents Next from reading local env files.
- `git diff --check` passed.
- Live DB SQL execution, migration application, real LINE/Stripe delivery, FFmpeg media execution, and paid-provider end-to-end checks were deliberately not performed under the owner's hard rules. SQL/transaction checks use mock clients; media/provider tests use mocks.

## Commit status

Observed `git log --oneline 79e1ef4..HEAD`:

```text
0fbb288 feat(line-intake): Phase 1 gap-fill (WIP checkpoint)
9f2a76a feat(line-intake): Phase 1 — LINE OA review system, render lane routing, service packages
```

The checkpoint appeared while this session was running. This session's explicit-path `git add`/commit attempts were denied because `.git` is read-only to this runtime (`Unable to create .git/index.lock: Permission denied`). Changes after that checkpoint remain uncommitted. No reset, stash, rebase, cleanup, branch switch or push was attempted. Finishing the requested local commits requires a session with write access to `.git`.

## Configuration for Tho

Keep the flags off until the migrations are applied separately by the owner:

- REVIEW_SYSTEM_ENABLED, LINE_INTAKE_ENABLED, RENDER_LANE_ENABLED (default off).
- LINE_CHANNEL_ID, LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN.
- REVIEW_PREVIEW_JWT_SECRET and REVIEW_PUBLIC_ORIGIN (absolute public HTTPS origin).
- STRIPE_WEBHOOK_SECRET; STRIPE_PAYMENT_LINK_TRIAL / STARTER / GROWTH / PRO must be real TEST Payment Links. STRIPE_ALLOW_LIVE defaults false and should remain unset/false for Phase 1. Local signature verification does not call Stripe or require a live key.
- Main worker: RENDER_LANE=main (or unset). Mar-PC: RENDER_LANE=backup (operator_pc alias supported).
- RENDER_MAIN_STALE_SECONDS defaults 90; RENDER_BACKUP_QUEUE_SECONDS defaults 600.
- Existing private Spaces credentials/configuration. Existing FFMPEG_PATH or ffmpeg on PATH; new optional FFPROBE_PATH or ffprobe on PATH.
- Existing AI-provider settings are unchanged; no keys were read or tested.

Migrations to apply separately, in order: `048_review_core.sql`, `049_line_intake.sql`, `050_service_packages.sql`, `051_line_webhook_events.sql`, `052_line_runtime.sql`. None was applied here.

Cleanup remains dry-run by default, via `scripts/cleanup-line-uploads.ts`; it was never run. Its selection/pagination/default policy is tested through the shared service with mock S3 responses.

## Owner decisions versus design docs

- Mac Mini main / Mar-PC backup overrides the docs' isolated Mar-PC primary lane.
- Server-side deterministic routine replies override routing every chat through an external bot.
- No renewal, follow-up or reminder pushes are sent. Review prompts wait for a shop status message and use its reply token; only results/delivery are pushed.
- Stripe TEST Payment Links replace any payment-slip review flow.
- LINE shop-selected reviews skip Tho's duplicate review and follow storyboard → voice → video.
- LINE raw-file retention is seven days; existing studio retention remains unchanged.
- Pipeline hooks are implemented now, overriding the docs' later-phase deferral. LINE permits up to 90 seconds while retaining the existing studio/server policies.

## Round 3 — Nov 1 2026

Branch `feat/ai-editing-line` (HEAD `f4ab1b6`). All changes build and pass the full Jest suite (1714 tests, 164 suites).

### Codex review findings fixed

| Finding | Severity | Fix |
|---|---|---|
| 1 | High | `elevenLabsTtsService.ts` and `veoService.ts` — `PutObjectCommand` now uses `ACL: "private"` when `isPrivateLineStorage()` is true. `CacheControl` header is also omitted for private objects. |
| 2 | High | `LineIntakeService.findActiveOrderWithBalance` checks for an active paid order with remaining clips; `LineWebhookService` `start_job` handler carries the existing `orderId` forward and skips package selection + payment when balance > 0. |
| 3 | High | `lineReviewGate.ts` now reads `captionedExport_9_16_assetId` (and 16:9/1:1/4:5 fallbacks) instead of the cleared `animatedVideoAssetId`. Admin review page generates 30-minute signed preview URLs server-side via `spacesSignedUrl` and renders video/audio/image players. |
| 4 | High | Same root fix as Finding 3 — correct asset ID reference means the re-gate after rerender produces a new `pending` item with `renderState='none'`, unblocking `ReviewService.decide()`. |
| 5 | Medium | Admin review page includes a `<textarea>` + Send reply button for `customer_reply` items; the existing `manual_reply` decision path is wired through `ReviewService.decide()`. |
| 6 | Medium | `ReviewOrder.test.ts` completely rewritten — drives real `ReviewService` + `onLineReviewGate` with fresh Map-based mock repos; tests gate ordering, shop audience, the full edit→rerender→approve cycle, studio no-op, and duration/revision limits. |

### New features implemented

| Item | Description |
|---|---|
| 5 (env) | `.env.example` — added `RENDER_LANE_ENABLED`, `REVIEW_PUBLIC_ORIGIN`, `STRIPE_ALLOW_LIVE`, `GROKBOT_REVIEW_WEBHOOK_URL/KEY`, `REVIEW_ADMIN_TOKEN`, `REVIEW_REMINDER_HOURS`, `RENDER_MAIN/BACKUP_STALE_SECONDS`, `LINE_TAKEOVER_TIMEOUT_HOURS` |
| 8 | Render-lane staleness thresholds configurable via `RENDER_MAIN_STALE_SECONDS` / `RENDER_BACKUP_QUEUE_SECONDS` env vars with safe defaults (90s/600s) |
| 9 | `GrokBotNotifier` — HMAC-SHA256 signed webhook to `GROKBOT_REVIEW_WEBHOOK_URL`, expiring preview links, Thai summary per typeKey, no PII, 5s timeout, never throws |
| 10 | `GET /api/admin/review` + `POST /api/admin/review/[id]/decision` — Bearer token auth (timing-safe), reuse `ReviewService.decide()`, 409 on version_conflict/render_not_ready |
| 11 | `ReviewReminderService.runReviewReminders` — finds overdue items via `listDueForReminder`, notifies Grok Bot, bumps `nextReminderAt` + `reminderCount`; runnable via `scripts/review-reminder.ts` |
| 12 | Per-shop takeover flag — `LineAccount.takeoverActive/takeoverExpiresAt`, `setTakeover` in interface + mock + Postgres repo; `processLineEvent` returns `intent='takeover'` when active; `POST /api/admin/line/takeover` toggle API; migration 053 |

### Commits

```text
a10bb5c  feat(line-intake): webhook durability, atomic decisions, private LINE storage paths, preview token checks (checkpoint 2)
1d94662  fix(line-phase1): package carry-over — reuse active paid balance per LINE user (C)
6e81367  feat(line-phase1): Grok Bot notifier, admin review API, reply editor (D)
f4ab1b6  feat(line-phase1): 12h reminder job, per-shop takeover flag, migration 053 (E)
```

(Milestones A and B were committed in the prior checkpoint session.)

### Verification

- `npx tsc --noEmit`: passed (exit 0)
- `npx jest --no-coverage`: 164 suites, 1714 tests, 0 failures (exit 0)
- `npm run build`: passed (exit 0)
- New migration: `053_review_reminder_takeover.sql` — apply after 052 in the same coordinated rollout window

## Open handoff questions

1. Supply real TEST Payment Links, the public review origin, and the shop's authoritative menu/price/promotion data. Placeholders are not usable purchases.
2. Confirm the default 90-second heartbeat-stale and 600-second queue-wait backup thresholds for the actual workers.
3. Enable the flags only after the migration and worker rollout is coordinated. The render worker also drains review execution/notification outbox events.
4. Provide `.git` write access in a follow-up session to finish the requested local milestone commits. No application deployment or live verification was attempted.

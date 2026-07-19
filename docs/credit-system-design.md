# Credit System Design — Free First Request + Pay-to-Download

**Status:** Design (2026-07-18)
**Model:** First request generates free; payment (49 credits) is required only at the final step to download without watermark. Second request onward: 49 credits charged at submission, download unlocked immediately.

---

## 1. Current state (what the code already does)

The backend already implements this exact model. The **frontend does not know about it** — that is the entire gap, and it's why a new 0-credit user (screenshot) sees a blocking "insufficient credits" warning and a disabled submit button.

### Already built (backend) ✅

| Concern | Where | Behaviour |
|---|---|---|
| Trial detection | `ClipRequestService.isFirstRequest()` | True when no request of the user has `submittedAt` set |
| Free first submission | `ClipRequestService.submitRequest()` | Skips affordability check + charge when `isTrial` |
| Paid submissions (2nd+) | same | Requires + deducts `REQUEST_COST_CREDITS` (49) at submission |
| Pay-to-download | `ClipRequestService.unlockDownload()` | Charges 49, sets `downloadUnlocked: true`, idempotent |
| Download paywall | `GET /api/requests/[id]/download` | 402 while `downloadUnlocked === false` (staff bypass for QA) |
| Unlock endpoint | `POST /api/requests/[id]/unlock-download` | Wraps `unlockDownload()` |
| Watermarked preview | `ffmpegService.applyTiledWatermark()` + `VideoGenerationService._renderWatermarkedSibling()` | Tiled full-frame "RClipper" watermark rendered per ratio on the Mac worker; stored as `AssetType.WatermarkedPreview`, linked via `sourceAssetId`. Failure = withhold preview, never leak clean master |
| Locked viewing | `dashboard/requests/[id]/page.tsx` | Locked owners see only `WatermarkedPreview` assets |
| Unlock UX | `UnlockDownloadPanel` | Locked → routes to `/dashboard/credits?unlockRequest=…&returnTo=…` (top-up + unlock); unlocked → presigned download buttons |
| Payments | `PaymentService` (Stripe PromptPay QR + card), `CreditService.creditTopup()` | 1 credit = ฿1, atomic Pending→Paid claim, idempotent webhook + poll backstop |
| Ledger | `CreditTransaction` (immutable), `TransactionType.RequestCharge/RequestRefund/TopUp/…` | `referenceId` → `clip_requests.id` |
| Pricing config | `config/credits.ts` | 98 full / 49 launch price via `LAUNCH_DISCOUNT_ACTIVE`; top-up bundles 49–980 |
| Trial flag persisted | `ClipRequest.isTrialRequest` (`is_trial_request` column) | Set by `submitRequest()`; mapped in both Mock and Postgres repos |

### Broken/missing (frontend + summary layer) ❌

1. **Dashboard warning** (`dashboard/page.tsx`): `canAfford = balance >= 49` with no trial awareness → new user is told they can't submit. The "+ คำขอใหม่" CTA also reads as disabled.
2. **`NewRequestForm`**: `insufficientCredits = creditBalance < COST` **disables the submit button** — the UI blocks the free trial request the backend would accept.
3. **`requests/new/page.tsx` / `PackageSelector`**: only passes `creditBalance`; never computes trial eligibility.
4. **`RequesterDashboardService.getDashboardSummary()`**: no `trialAvailable` field.
5. **Copy**: dashboard pricing card says "บัญชีใหม่เริ่มต้นที่ 0 เครดิต" with no mention that the first clip is free to generate.

---

## 2. Target user flows

### Flow A — New user, first request (trial)
1. Register → wallet created at 0 credits (unchanged).
2. Dashboard shows a **trial banner** instead of the insufficient-credits warning: "คลิปแรกฟรี — สร้างได้เลย จ่ายเมื่อพอใจตอนดาวน์โหลด (49 เครดิต)".
3. New-request form submits with 0 credits; form shows cost as "ฟรี (จ่าย 49 เครดิตตอนดาวน์โหลด)".
4. Pipeline runs normally. All previews the user sees are the watermarked siblings.
5. At final approval/complete, `UnlockDownloadPanel` shows: pay ฿49 (top-up → auto-unlock via `unlockRequest` param) → `downloadUnlocked` → clean masters downloadable in all ratios.
6. Never pays → keeps watermarked preview only; clean master retained but locked.

### Flow B — Second request onward
1. Dashboard/form show the real gate: balance < 49 → warning + link to top-up (not "contact support").
2. Submission checks + deducts 49 immediately; `downloadUnlocked: true` from the start.
3. Download available as soon as masters exist, no extra charge.

---

## 3. Design decisions & edge cases

**D1. When is the trial consumed?** At **submission** (current behaviour — first `submittedAt` set). Rationale: simple, race-safe enough, and matches "generation is the free part".
- **Edge:** trial request gets `Rejected` before any video is generated → user consumed the trial for nothing. **Recommendation:** on staff rejection of a trial request, reset eligibility. Cleanest mechanism: persist trial state on the request, not derive it (see D2), and have `isFirstRequest()` ignore rejected trial requests: `all.every(r => r.submittedAt === null || (r.isTrial && r.status === Rejected))`.

**D2. Trial flag persistence — already done.** `ClipRequest.isTrialRequest` exists, is set by `submitRequest()`, and is mapped in both repos. Use it (not `downloadUnlocked === false`) as the source of truth for trial-ness in UI and in D1's eligibility reset.

**D3. Concurrency on "first" check.** Two simultaneous submissions could both pass `isFirstRequest()` → two free requests. Low risk (single user, manual flow), but when Phase-2B repos move to Postgres, enforce with a partial unique index: `CREATE UNIQUE INDEX one_trial_per_user ON clip_requests (user_id) WHERE is_trial = true`.

**D4. Price at unlock = price at submission-time list.** `unlockDownload()` reads `REQUEST_COST_CREDITS` at unlock time. If `LAUNCH_DISCOUNT_ACTIVE` is toggled off while a trial is in flight, the user would be quoted 98 after being promised 49. **Recommendation:** snapshot the unlock price onto the request at submission (`unlockPriceCredits: 49`) and charge that.

**D5. Unlock timing.** Allow `unlockDownload()` any time after clean masters exist (i.e., request has ≥1 `FinalClip` asset); reject earlier with a clear error so a user can't pay for a request that later fails. Refund path if pipeline fails *after* payment: existing `refundCredits()` + `TransactionType.RequestRefund`.

**D6. Watermark failure.** Already handled: locked + no watermarked sibling → withhold preview entirely. Keep.

**D7. Ledger.** No schema change. Trial unlock is a normal `RequestCharge` (description "Unlock download: …", `referenceId` = request id). Optional nicety: new `TransactionType.UnlockCharge` for reporting; not required.

---

## 4. Implementation plan (the actual work)

All backend logic exists; this is mostly UI + a small schema/service delta.

### Phase 1 — Make the UI trial-aware (unblocks the screenshot problem)
1. `RequesterDashboardService.getDashboardSummary()` → add `trialAvailable: boolean` (call `clipRequestService.isFirstRequest(userId)`).
2. `dashboard/page.tsx` → when `trialAvailable`, replace the yellow warning with a green/blue trial banner; keep "+ คำขอใหม่" fully enabled. Insufficient-credits warning only when `!trialAvailable && balance < 49`, and link it to `/dashboard/credits` (top-up) instead of "contact support".
3. `requests/new/page.tsx` → compute `trialAvailable`, pass through `PackageSelector` → `NewRequestForm`.
4. `NewRequestForm` → new prop `trialAvailable`; when true: `insufficientCredits` is ignored, cost display becomes "ฟรี — จ่าย 49 เครดิตเมื่อดาวน์โหลดแบบไม่มีลายน้ำ", submit enabled.
5. Pricing card copy: "คลิปแรกสร้างฟรี ดาวน์โหลดไฟล์จริง 49 เครดิต · คำขอถัดไป 49 เครดิต/รายการ".

### Phase 2 — Harden the trial semantics
6. Migration: `clip_requests` + `unlock_price_credits int null` only (`is_trial_request` already exists). Partial unique index from D3: `ON clip_requests (user_id) WHERE is_trial_request = true`.
7. `submitRequest()` → additionally snapshot `unlockPriceCredits = REQUEST_COST_CREDITS` on trial requests (trial flag already set).
8. `unlockDownload()` → charge `existing.unlockPriceCredits ?? REQUEST_COST_CREDITS`; require ≥1 clean `FinalClip` asset (D5).
9. `isFirstRequest()` → exclude rejected trial requests (D1) so a rejected trial restores eligibility: `all.every(r => r.submittedAt === null || (r.isTrialRequest && r.status === Rejected))`.

### Phase 3 — Tests
10. `tests/services/ClipRequestService.test.ts` (fresh Mock repos pattern): first submit free at 0 balance; second submit blocked at <49 / charged at ≥49; unlock idempotent; unlock blocked before finals exist; unlock uses snapshotted price; rejected trial restores eligibility; refund path.

---

## 5. Money flow summary

```
Top-up (PromptPay/card, 1cr = ฿1)  ──►  wallet balance
                                          │
        Request #1 (trial)                │   Request #2+
        submit: charge 0                  │   submit: charge 49  ──► RequestCharge(-49)
        generate + watermark preview      │   downloadUnlocked = true
        unlock: charge 49 ────────────────┘
          └► RequestCharge(-49), downloadUnlocked = true
        pipeline fails after payment ──► RequestRefund(+49)
```

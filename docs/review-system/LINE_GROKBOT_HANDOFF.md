# LINE → Grok Bot (RCaveBot) customer hand-off

Status: handoff admin endpoints and escalation notices IMPLEMENTED, 2026-11-01. Other proposals remain design-only unless explicitly marked implemented. Written from the code on `feat/ai-editing-line` (HEAD at time of writing: e5fbcba + the 2026-11-01 LINE intake fixes). No secret values appear here. `GROKBOT_REVIEW_WEBHOOK_URL` is intentionally **not** set on Mar-PC.

Goal: unrecognised customer text in the LINE OA (and an explicit "ติดต่อ" / "คุยกับคน" request) is forwarded from our server to a dedicated customer-facing Grok Bot (**RCaveBot**). RCaveBot answers the shop through a token-authed admin endpoint that pushes a LINE message to that user.

---

## 1. What exists today (read from code)

### 1.1 How unknown text is handled now
`src/services/line/LineWebhookService.ts` → `classifyIntent()` is a small regex classifier:

| Intent | Matches (substring / regex on lower-cased text) |
|---|---|
| greeting | `^(สวัสดี\|หวัดดี\|ดีจ้า\|ฮัลโหล\|hi\|hello)` |
| package_info | `แพ็กเกจ\|ราคา\|package\|price` |
| status | `สถานะ\|ความคืบหน้า\|งานไปถึงไหน\|status` |
| help | `ช่วยเหลือ\|help\|คำสั่ง` |
| start_job | `เริ่มงาน\|สั่งงาน\|ทำวิดีโอ` |
| confirm | `ยืนยัน\|อนุมัติ\|โอเค\|ok\|ตกลง` (substring — note "ok" inside any word also matches) |
| wants_human | `คุยกับ(คน\|แอดมิน\|เจ้าหน้าที่)\|ขอสายคน\|human` |
| choose_package:<code> | package code / first word of Thai package name |
| unknown | everything else |

"ติดต่อ" is **not** a command today (it falls to `unknown`).

For `unknown` text that is not consumed by the current conversation state (brief, preferences, …) the service:
1. calls `createReviewItem` (wired in `src/app/api/line/webhook/route.ts`), which creates a review item `typeKey: 'customer_reply'`, `title: 'LINE: unknown'`, `payload: { text, lineUserId }`, `idempotencyKey: 'line:<eventId>'`, always-review;
2. replies with `unknownMsg` ("ขออภัยค่ะ ไม่เข้าใจคำสั่ง 😅 พิมพ์ "ช่วยเหลือ" …").

`wants_human` does the same but replies `escalateMsg` first and sets `signals.wants_human = true`.

The review item enqueues a `review.created` outbox row; the worker (`LineReviewOutboxWorker`) calls `notifyGrokBot(item, { event: 'escalation' })`. In the 2026-11-01 test both "unknown" texts produced `review_items` rows (`customer_reply`, pending) and `review.created` outbox rows marked **sent** — but because `GROKBOT_REVIEW_WEBHOOK_URL` is unset, `notifyGrokBot` returns without sending anything and the outbox still marks the event sent. **Those escalations are not re-sent later when the URL is configured.**

### 1.2 Admin API (all exist today)
Auth for every admin route: header `Authorization: Bearer <REVIEW_ADMIN_TOKEN>` (exact prefix `Bearer `, timing-safe compare). `503 {"error":"Not configured."}` when `REVIEW_ADMIN_TOKEN` is unset; `401 {"error":"Unauthorized."}` on a wrong/missing token. Base URL during the test = `REVIEW_PUBLIC_ORIGIN` (the trycloudflare origin).

**a) List pending review items** — `GET /api/admin/review`
- Response 200: `{ "items": ReviewItem[] }` — each item includes `id`, `shortCode`, `typeKey` (`customer_reply`, `script`, `tts`, `video`, …), `status`, `version` (number, needed for decisions), `shopUserId`, `requestId`, `payload` (for `customer_reply`: `{ "text": "<customer text>", "lineUserId": "U…" }`), `signals`, `createdAt`, ….
- This is the only place the customer's text is available to a bot today.

**b) Decide a review item (approve / reject / free-text reply)** — `POST /api/admin/review/{id}/decision`
- Body: `{ "version": number, "decision": "approve" | "reject" | "manual_reply", "replyText"?: string, "allowDuringTakeover"?: boolean }` (`replyText` required for `manual_reply`).
- `actorVia` is recorded as `grokbot_app`, `actorUserId` null.
- Responses: `200 { "item": ReviewItem }`; `400 {"error":"Invalid JSON."}` / `400 {"error":"version (number) and decision (approve|reject|manual_reply) are required."}` / `400 {"error":"replyText is required for manual_reply."}`; `409 {"error":"version_conflict"|"render_not_ready"|"not_found"}`; `500 {"error":"Internal error."}`.
- `manual_reply` = **the existing way to send a free-text reply to the shop**: status → `edited`, `finalPayload.reply_text = replyText`, outbox `review.decided`; the worker then `push`es `reply_text` as a LINE text message to every active LINE account of that shop. A manual reply during active takeover requires explicit `allowDuringTakeover: true`; the worker checks the flag again at delivery.
- Example: `POST /api/admin/review/28625f5e-…/decision` `{"version":1,"decision":"manual_reply","replyText":"ได้รับแล้วค่ะ ทีมงานกำลังตรวจสอบไฟล์ทั้ง 3 ไฟล์"}` → `200 {"item":{…,"status":"edited","resolution":"manual_reply",…}}`.
- "Revise" (`decision: "edit"` with edits) exists in `ReviewService.decide` but is **not exposed** by this route (route accepts only approve|reject|manual_reply).

**c) Per-shop takeover on/off** — `POST /api/admin/line/takeover`
- Body: `{ "lineChannelId": string, "lineUserId": string, "active": boolean, "hours"?: number }` (`hours` default `LINE_TAKEOVER_TIMEOUT_HOURS`, 24).
- Responses: `200 { "ok": true }`; `400` on missing fields; `404 {"error":"Account not found."}` (also when `LINE_TEST_MODE=true` and the account is not `is_test`).
- On `active: true` an outbox `takeover_on` event is queued (notifier event `takeover_on`, no LINE identity in payload).
- While active, `processLineEvent` returns `intent: 'takeover'` immediately: the bot does not reply, and automated outbox deliveries for that shop are deferred.

**d) Storyboard restore** — `POST /api/admin/line/storyboard` body `{ "action": "restore", "requestId": uuid, "versionId": uuid, "expectedVersionId": uuid }` (only when `LINE_SCENE_EDIT_ENABLED=true`; errors `not_configured`/`unauthorized`/`disabled`/`not_found`/`version_conflict`/`invalid_input`).

**There is no endpoint to push free text to a shop without an existing review item.** Proposed in §3.3.

### 1.3 Grok Bot notifier (`src/services/review/GrokBotNotifier.ts`)
- **Configured** = `GROKBOT_REVIEW_WEBHOOK_URL` set **and** (`GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER` non-empty **or** `GROKBOT_REVIEW_WEBHOOK_KEY` set). When not configured, the notifier is a no-op. `POST` with 5 s timeout; non-2xx → error (outbox retries).
- **Authorization header precedence:** if `GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER` is non-empty after trimming and stripping an optional leading `Authorization:` label (case-insensitive, e.g. `Authorization: Bearer x` → `Bearer x`), the cleaned value is sent as the `Authorization` header. If stripping the label leaves nothing, the header is treated as unset and falls back to `Bearer <GROKBOT_REVIEW_WEBHOOK_KEY>`. A plain value with no label (e.g. `Bearer x`) is passed through unchanged.
- **HMAC headers** (`X-Grokbot-Signature: sha256=<hex>`, `X-Grokbot-Timestamp: <unix seconds>`) are included whenever `GROKBOT_REVIEW_WEBHOOK_KEY` is set, regardless of `GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER`.
- The key, `GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER` (and its token portion), the `Authorization` header value and the webhook URL are never logged; delivery errors are redacted (`[REDACTED]`) before they are logged or rethrown to the outbox.
- Synthetic test: `node scripts/send-test-notifier-event.cjs` sends one `review_pending` event (`requestId`/`itemId` = `test-…`, `summaryTh` = "ทดสอบการแจ้งเตือนจากระบบ RClipper (test)", no customer data) through `notifyGrokBot` and prints only the HTTP status.
- Signature: `HMAC-SHA256(key = GROKBOT_REVIEW_WEBHOOK_KEY, message = "<timestamp>.<raw JSON body>")`, hex-encoded. Receiver should recompute over the exact raw body bytes and reject timestamps older than ~5 minutes.
- Payload (same schema for every event):
```json
{
  "event": "review_pending | review_needed | escalation | reminder | takeover_on",
  "requestId": "uuid | null",
  "itemId": "uuid (review item id; for takeover_on: outbox event id)",
  "shortCode": "string ('' for takeover_on)",
  "typeKey": "customer_reply | script | tts | video | out_of_package | complaint | …",
  "audience": "string (payload.audience, default 'admin')",
  "orderId": "uuid | null",
  "summaryTh": "short Thai label for typeKey",
  "previewLinks": [{ "role": "string", "url": "signed URL, 1 h", "mime": "string" }],
  "precheckIssues": ["optional Thai strings"],
  "visualShotFlags": [{ "sceneIndex": 0, "assetId": "uuid", "rule": "min_shot|…", "measuredValue": 0 }],
  "notifiedAt": "ISO timestamp"
}
```
- **Escalation notice IMPLEMENTED:** customer-reply notices use only the allowlisted fields shown in section 3.3. Per-shop delivery cap is counted from sent escalation outbox rows over the preceding 60 seconds (default 6, `LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN`). At the cap, the worker defers the row for 60 seconds without calling the webhook. The review item remains stored. No customer text, reason, LINE identity, audience, signals, or asset links are forwarded.
- Which event when: `review.created` → `escalation` for `customer_reply`/`complaint`/`out_of_package`, else `review_needed`; reminder sweep → `reminder`; takeover on → `takeover_on` (generic, no identity).
- **No PII by design: the customer's text and LINE user id are NOT in the payload.** A bot must call `GET /api/admin/review` to read `payload.text`.

**Grok Bot routine webhook trigger:** RCaveBot's routine trigger authenticates with `Authorization: Bearer <key>` (the same value as `GROKBOT_REVIEW_WEBHOOK_KEY`); it does not verify the HMAC headers, so treat both the trigger URL and the key as secrets. The design still uses **notify-then-fetch**: the webhook carries only opaque ids, and RCaveBot fetches content over HTTPS with `REVIEW_ADMIN_TOKEN`, so a leaked trigger can at most cause a harmless fetch.

---

## 2. Gaps found
1. The notifier never carries customer text (intentional), so RCaveBot needs a fetch endpoint scoped to one item (listing all pending items with full PII is too broad for a customer bot).
2. With the URL unset, `review.created` events are marked sent without delivery (no backfill).
3. There is no free-text push endpoint without a review item, and no rate limit on outbound pushes.
4. "ติดต่อ" is not recognised; `confirm` matches the substring `ok` anywhere.
5. Takeover currently silences the bot entirely, and nothing tells RCaveBot that a human took over.

---

## 3. Proposed design

### 3.1 Flags / env (Mar-PC test first)
| Env | Default | Meaning |
|---|---|---|
| `LINE_GROKBOT_HANDOFF_ENABLED` | `false` | master switch |
| `GROKBOT_CUSTOMER_WEBHOOK_URL` | unset | RCaveBot routine webhook trigger URL (secret) |
| `GROKBOT_CUSTOMER_WEBHOOK_KEY` | unset | HMAC key (signature sent anyway, in the existing format, for receivers that can verify it) |
| `LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN` | `6` | inbound forward rate limit |
| `LINE_HANDOFF_REPLY_PER_SHOP_PER_HOUR` | `20` | outbound bot reply limit |
| `LINE_HANDOFF_REPLY_GLOBAL_PER_HOUR` | `200` | global outbound cap (protects the LINE OA push quota) |

Separate from `GROKBOT_REVIEW_WEBHOOK_*` so the admin review bot (Tho) and the customer bot (RCaveBot) can be different routines.

### 3.2 Inbound: forwarding customer text
Trigger points in `processLineEvent`: (a) `unknown` text not consumed by state; (b) `wants_human`, extended with `ติดต่อ|ติดต่อเจ้าหน้าที่|ติดต่อแอดมิน`; (c) optionally free text in `in_progress` state.

Flow (unchanged parts in italics):
1. *Create the `customer_reply` review item as today* (idempotency `line:<eventId>`, payload `{ text, lineUserId }`).
2. If `LINE_GROKBOT_HANDOFF_ENABLED`, also enqueue outbox `customer.message` (`dedupe_key = 'handoff:' + eventId`, `review_item_id` set, payload `{ item_id, line_account_id, is_test }`). Do it in the same transaction as the item where the repository allows it.
3. Immediate LINE reply (reply token, free): instead of "ไม่เข้าใจคำสั่ง", send "ได้รับข้อความแล้วค่ะ ทีมงานจะตอบกลับโดยเร็ว 🙏" (still list "ช่วยเหลือ" as a hint). Fall back to the current message when hand-off is disabled.
4. Outbox worker delivers `customer.message` to `GROKBOT_CUSTOMER_WEBHOOK_URL`:
```json
{
  "event": "customer_message",
  "itemId": "uuid",
  "conversationRef": "uuid (line_accounts.id — opaque, not the LINE user id)",
  "intent": "unknown | wants_human",
  "state": "awaiting_files | in_progress | …",
  "requestId": "uuid | null",
  "isTest": true,
  "takeoverActive": false,
  "receivedAt": "ISO",
  "fetchUrl": "https://<origin>/api/admin/line/handoff/<itemId>"
}
```
Headers: the existing `X-Grokbot-Timestamp` and `X-Grokbot-Signature` scheme with `GROKBOT_CUSTOMER_WEBHOOK_KEY`. No customer text and no LINE user id in the trigger body.
5. Coalescing: if the same shop sends several texts within 10 s, forward one `customer.message` (the latest item) and let the fetch endpoint return all unanswered texts.

### 3.3 Admin handoff endpoints — IMPLEMENTED

All three endpoints use exact-prefix `Authorization: Bearer <REVIEW_ADMIN_TOKEN>` with timing-safe comparison.
Common responses: 503 `{"error":"Not configured."}` when unset; 401 `{"error":"Unauthorized."}` for missing/wrong token; 404 `{"error":"not_found"}` for missing or out-of-scope items/accounts.
Scope is symmetric: `LINE_TEST_MODE === 'true'` exposes only test accounts/items; every other value exposes only non-test accounts/items. Item ownership is resolved through its LINE account in `LINE_CHANNEL_ID` (default `default`), or an active account of its shop when the item has no LINE identity.

**POST `/api/admin/line/reply`**

Body fields:
- `itemId?: string(UUID)`, `conversationRef?: string(UUID, line_accounts.id)`: at least one required; both must identify the same account.
- `text: string`: trimmed, 1-1000 characters.
- `idempotencyKey: string`: 8-100 characters, only `[A-Za-z0-9_.:-]`.
- `expectedVersion?: positive integer`: required with `itemId` and `resolve: true`.
- `resolve?: boolean` (default false).
- `actor: "rcavebot" | "human"`.
- `allowDuringTakeover?: boolean` (default false).

Example body: `{"conversationRef":"11111111-1111-4111-8111-111111111111","text":"Hello","idempotencyKey":"answer:12345678","actor":"human","allowDuringTakeover":true}`.

Responses:
- 202 `{"queued":true,"outboxEventId":"22222222-2222-4222-8222-222222222222"}`.
- 200 `{"duplicate":true,"outboxEventId":"22222222-2222-4222-8222-222222222222"}`: same dedupe key, no second enqueue, resolution, or push.
- 400 `{"error":"invalid_input","detail":"bad_json"}` for malformed JSON; field validation uses the field name (e.g. `text`, `actor`, `idempotencyKey`, `expectedVersion`, `allowDuringTakeover`), or Zod's object error. Missing ids: `{"error":"invalid_input","detail":"missing_ids"}`; missing version for resolution: `{"error":"invalid_input","detail":"expectedVersion_required"}`; mismatched ids: `{"error":"invalid_input","detail":"conversationRef_mismatch"}`.
- Common 401/503/404 responses above.
- 409 `{"error":"takeover_active"}`: active, unexpired takeover blocks every rcavebot reply, and human replies without `allowDuringTakeover: true`.
- 409 `{"error":"version_conflict"}`: resolution version differs.
- 429 `{"error":"rate_limited"}`, header `Retry-After: 3600` (actual seconds until the oldest counted row exits the window, minimum 1). Limits count all `line.reply` rows created in the last hour: per account `LINE_HANDOFF_REPLY_PER_SHOP_PER_HOUR` default 20, global `LINE_HANDOFF_REPLY_GLOBAL_PER_HOUR` default 200.

The transaction serializes reply quota/dedupe checks, enqueue, audit, and optional manual-reply resolution. Dedupe key is `line.reply:<idempotencyKey>`. Server-only outbox payload holds `lineAccountId`, `itemId|null`, `text`, `actor`, `allowDuringTakeover`, `resolve`, and `expectedVersion|null`. Resolution records `actorVia: grokbot_app` and suppresses the usual `review.decided` push. Only `line.reply` delivers it.
The worker checks account scope/status and takeover again, marks blocked rows dead with `takeover_active`, and pushes using the UUID outbox event id as `X-Line-Retry-Key`. Text never goes to the notifier.

**GET `/api/admin/line/handoff/{itemId}`**

Read-only: no item-open records, state updates, or takeover expiry writes. No body.
200 example (nullable conversation/request/job fields shown):
```json
{
  "itemId":"11111111-1111-4111-8111-111111111111", "version":1,
  "status":"pending", "typeKey":"customer_reply", "shortCode":"ABC123",
  "isTest":false, "conversationRef":"22222222-2222-4222-8222-222222222222",
  "takeoverActive":false, "takeoverExpiresAt":null, "customerText":"Hello",
  "messages":[{"itemId":"11111111-1111-4111-8111-111111111111","text":"Hello","receivedAt":"2026-11-01T00:00:00.000Z","status":"pending"}],
  "replies":[{"outboxEventId":"33333333-3333-4333-8333-333333333333","text":"Hello back","actor":"human","status":"sent","createdAt":"2026-11-01T00:01:00.000Z"}],
  "conversation":{"state":"in_progress","requestId":null},
  "request":null, "job":null
}
```
Messages: up to 10 most recent customer_reply items for the same shop and LINE user, newest last, across all statuses. Replies: up to 10 most recent line.reply rows for the account, newest first, across all statuses/ages. `customerText` is nullable. An absent conversation returns `{"state":null,"requestId":null}`. A linked request returns `{"id":"uuid","status":"Submitted"}`; a linked job returns `{"status":"awaiting_content_approval","currentStep":"analyzing_content"}` using stored enum values. No files or other context is exposed.
Other responses: common 401/503/404 above.

**POST `/api/admin/line/handoff/{itemId}/escalate`**

Body: `{"reason"?: string (at most 500 characters)}`; example `{"reason":"Needs a human"}` or `{}`.
Sets `signals.wants_human = true` and optional `signals.escalation_reason` server-side. Enqueues `handoff.escalate`, dedupe key `handoff.escalate:<itemId>`.
Responses: 200 `{"ok":true}`; repeat 200 `{"ok":true,"duplicate":true}`; 400 `{"error":"invalid_input","detail":"bad_json"}` or `{"error":"invalid_input","detail":"reason"}`; common 401/503/404 above.
No takeover changes. The worker delivers notifier event `escalation` with the same per-shop cap as customer-reply review.created.

Escalation payload example (exact allowlist; no reason, customer text, or LINE ids):
```json
{
  "event":"escalation", "requestId":null,
  "itemId":"11111111-1111-4111-8111-111111111111", "shortCode":"ABC123",
  "typeKey":"customer_reply", "orderId":null,
  "summaryTh":"ลูกค้าส่งข้อความที่ระบบตอบไม่ได้ — รอทีมงาน/RCaveBot ตอบ",
  "previewLinks":[], "notifiedAt":"2026-11-01T00:00:00.000Z"
}
```

**Existing POST `/api/admin/review/{id}/decision` — takeover change IMPLEMENTED**

Adds optional `allowDuringTakeover?: boolean`. Example: `{"version":1,"decision":"manual_reply","replyText":"Hello","allowDuringTakeover":true}`.
For manual_reply, missing/out-of-scope account/item returns 404 `{"error":"not_found"}`; active takeover without the flag returns 409 `{"error":"takeover_active"}`. Invalid flag type returns 400 `{"error":"invalid_input"}`. Success remains 200 `{"item":{"id":"uuid","status":"edited","resolution":"manual_reply","version":2}}` (full ReviewItem).
The flag is persisted in review.decided payload and enforced again before manual delivery. All other decisions retain existing semantics and responses in section 1.2b.

No migration is required by this implementation. Escalation limits count sent review_outbox rows in the last 60 seconds; review_items signals and review_outbox columns store flags and replies. A concurrently created, untracked 059_line_handoff.sql was left untouched and is not used by these routes or worker.

### 3.4 Rate limits and quotas
- Inbound: at most `LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN` forwards per shop per minute, with coalescing (§3.2.5); always create the review item (no customer text is lost), only the webhook call is limited.
- Outbound IMPLEMENTED: per account per hour and global per hour (§3.3), counted from outbox `line.reply` rows; `429` with `Retry-After`. Message length is capped at 1000 characters, plain text.
- LINE quota: reply tokens are free but single-use and expire in about a minute, so bot answers arrive as **push** messages, which count against the OA's monthly message quota. The global cap protects it; log the count per day.
- Webhook: 5 s timeout; outbox retries with backoff (existing), then `failed` after N attempts so that one broken trigger cannot block the queue.

### 3.5 Takeover interplay
- Takeover ON (human handling the shop): the inbound webhook already stops automated replies. With hand-off enabled, still create the review item, but **do not forward to RCaveBot**: send `customer_message` with `takeoverActive: true` to the admin/human channel (`GROKBOT_REVIEW_WEBHOOK_URL`) instead.
- IMPLEMENTED: takeover blocks rcavebot replies; human replies and manual_reply decisions require explicit `allowDuringTakeover: true` to bypass. The worker re-checks before delivery.
- When takeover is switched OFF or expires, unanswered items stay pending; RCaveBot may pick them up on its next run (send a `customer_message` for the newest one).
- IMPLEMENTED: `/escalate` flags and notifies for human attention; it does not modify takeover.

### 3.6 is_test
- The server forwards only accounts in the server's mode: with `LINE_TEST_MODE=true` only `is_test` accounts; on production only non-test accounts. The flag is carried in the payload (`isTest`) and enforced again on every fetch and reply endpoint (404 for out-of-scope ids).
- Test runs should use a separate RCaveBot trigger URL (or the routine checks `isTest` and labels replies).
- Outbox rows for hand-off are scoped by the existing review-outbox ownership rules (persisted `is_test` of the owning LINE account / request), so the production worker never delivers test hand-offs and vice versa.

### 3.7 Privacy / safety
- The trigger body has no PII; content is fetched with the token over HTTPS.
- RCaveBot only gets the shop's own messages plus the conversation and request status; it gets no payment data and no other shops.
- All bot replies are audited in `review_actions` (`actor_via = 'rcavebot'`) or the outbox (`line.reply` with the text) for later review.
- Prompt-injection: the customer text is untrusted input for RCaveBot; the endpoints only allow text replies and escalation, never approvals, refunds or package grants.

### 3.8 Implementation steps (when approved)
1. Add `ติดต่อ` to `wants_human`; tighten `confirm` to whole-word `ok`.
2. Add a `customer.message` outbox event, the notifier variant for `GROKBOT_CUSTOMER_WEBHOOK_URL`, and coalescing.
3. Add `GET /api/admin/line/handoff/{itemId}`, `POST /api/admin/line/reply` and `POST …/escalate`, with rate limiting (a counter table or outbox counts), plus tests.
4. Fix the "marked sent while the URL is unset" behaviour: skip and leave pending, or mark `skipped` so that a backfill is possible.
5. Optional: a dedicated `RCAVEBOT_ADMIN_TOKEN` with reply/escalate scope only.

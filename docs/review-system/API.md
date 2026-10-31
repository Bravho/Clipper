# RClipper ↔ Grokbot — API contract (v1)

Base: `https://app.rclipper.com/api/integrations/grokbot/v1`
โค้ด: `src/app/api/integrations/grokbot/v1/**/route.ts` + `_guard.ts` (ใช้ `api/travy/_guard.ts` เป็นแบบ)
รูปแบบ: JSON UTF-8 · เวลาเป็น ISO-8601 UTC · เงินเป็นบาท (number) · id เป็น UUID เว้นแต่ระบุอื่น

---

## 1. ความปลอดภัย

### 1.1 Request จาก grokbot (ทุก endpoint)

| Header | ตัวอย่าง | หมายเหตุ |
|---|---|---|
| `X-RC-Client` | `grokbot` | |
| `X-RC-Signature` | `t=1793424000,kid=k1,v1=9f2c…` | HMAC-SHA256(hex) |
| `Idempotency-Key` | `gb-msg-7f3a91…` | **บังคับทุก POST/PUT/PATCH** (≤ 128 ตัวอักษร) |
| `Content-Type` | `application/json` | |

```
string_to_sign = t + "." + METHOD + "." + path_with_query + "." + hex(sha256(raw_body))
v1             = hex(hmac_sha256(secret[kid], string_to_sign))
```
- ยอมให้เวลาคลาด ±300 วินาที · เทียบค่าด้วย `timingSafeEqual` · `GROKBOT_HMAC_KEYS=k1:<secret>,k2:<secret>` (ตั้งได้ 2 key ช่วงหมุนกุญแจ)
- body ว่าง (GET) ใช้ sha256 ของสตริงว่าง

### 1.2 Idempotency
- เก็บ `(client, Idempotency-Key)` → `(route, body_sha256, response)` เป็นเวลา 24 ชม.
- key เดิม + body เดิม → คืน response เดิม พร้อม header `Idempotent-Replay: true`
- key เดิม + body ต่าง → `422 idempotency_key_reused`
- key เดิมที่ยังประมวลผลไม่เสร็จ → `409 request_in_progress` (ให้ retry หลัง `Retry-After`)

### 1.3 Webhook จาก RClipper → grokbot
`POST {GROKBOT_WEBHOOK_URL}` · headers `X-RC-Signature` (secret แยก `GROKBOT_WEBHOOK_SECRET` คำนวณแบบเดียวกัน), `X-RC-Event-Id`, `X-RC-Event-Type`, `X-RC-Attempt`
- grokbot ต้องตอบ `2xx` ภายใน 10 วินาที (รับไว้ก่อนแล้วค่อยประมวลผลทีหลัง) และกันซ้ำด้วย `X-RC-Event-Id`
- Retry: 30 วิ, 2 นาที, 10 นาที, 30 นาที, 1 ชม. แล้วทุก 1 ชม. จนครบ 24 ชม. → `dead` (ขึ้นแจ้งที่ `/admin/review` + web push ถึง admin) · ถ้ายังส่งไม่สำเร็จหลัง 10 นาที ระบบจะส่ง web push สำรองถึง admin
- ลำดับ: **ไม่รับประกันลำดับ** ให้ grokbot ใช้ `item.version` + `item.updated_at` ตัดสินว่าข้อมูลไหนใหม่กว่า

---

## 2. รูปแบบ error

```json
{
  "error": {
    "code": "item_not_pending",
    "message": "Review item K7Q2MD is already approved.",
    "details": { "status": "approved", "decided_at": "2026-10-31T07:12:03Z" },
    "request_id": "req_01JBX…"
  }
}
```

| HTTP | code | ความหมาย / สิ่งที่ grokbot ควรทำ |
|---|---|---|
| 400 | `invalid_json`, `validation_failed` | body ผิดรูปแบบ (`details.issues` มาจาก Zod) · ห้าม retry |
| 401 | `signature_missing`, `signature_invalid`, `timestamp_skew` | ตรวจ secret และนาฬิกา · ห้าม retry |
| 403 | `client_disabled`, `actor_not_admin` | `admin_ref` ไม่ได้ map กับ admin |
| 404 | `not_found` | |
| 409 | `item_not_pending` | มีคนตัดสินไปแล้ว (เช่น จากเว็บ) · ให้อัปเดตการ์ดตาม `details` |
| 409 | `version_conflict` | ตัดสินบน version เก่า · ดึง item ใหม่แล้วแสดงการ์ดใหม่ |
| 409 | `request_in_progress` | Idempotency-Key กำลังประมวลผล · retry ตาม `Retry-After` |
| 409 | `gate_moved` | pipeline ไม่ได้อยู่ที่ gate นี้แล้ว |
| 410 | `item_expired` | |
| 422 | `idempotency_key_reused` | |
| 422 | `package_exhausted`, `package_expired`, `no_active_package` | |
| 422 | `rerender_not_supported` | type นี้ re-render ไม่ได้ |
| 429 | `rate_limited` | 120 req/นาที/คีย์ · ดู `Retry-After` |
| 500 | `integration_not_configured` | ฝั่ง RClipper ตั้ง env ไม่ครบ |
| 502/503 | `upstream_unavailable` | retry แบบ backoff |

---

## 3. ร้าน (shop)

### 3.1 `POST /shops/resolve` — หา/สร้าง requester จาก LINE user

```json
{
  "line_channel_id": "2008123456",
  "line_user_id": "U4af4980629a9b8c7d6e5f4a3b2c1d0e9",
  "display_name": "ครัวป้าแดง",
  "business": { "name": "ครัวป้าแดง สาขานิมมาน", "category": "restaurant", "location": "เชียงใหม่" },
  "create_if_missing": true
}
```
`200` (มีอยู่แล้ว) / `201` (สร้างใหม่)
```json
{
  "shop": {
    "user_id": "6a1d…",
    "business_name": "ครัวป้าแดง สาขานิมมาน",
    "linked_via": "auto_created",
    "completed_jobs": 0,
    "trusted": false,
    "active_package": null
  }
}
```
บัญชีที่สร้างใหม่จะเป็น `role=requester`, `email=line-<sha256(line_user_id)[0..16]>@line.rclipper.invalid` (ยังไม่ verify) และมี `business_profiles` ให้ด้วย

### 3.2 `POST /shops/link-code` — ผูก LINE กับบัญชีแอปที่มีอยู่แล้ว
`{ "line_channel_id": "...", "line_user_id": "..." }` → `201 { "code": "482913", "expires_at": "…+10m" }`
grokbot ส่งโค้ดนี้ให้ร้าน แล้วร้านไปกรอกในแอปที่ `/account/link-line` (หน้าใหม่ ต้อง login) ระบบจะรวมเป็น user เดิม

### 3.3 `GET /shops/{user_id}` — สรุปร้าน + แพ็กเกจที่ใช้อยู่ (`clips_left`, `revisions_left_by_request`)

---

## 4. แพ็กเกจ

### 4.1 `GET /packages` — รายการ `service_packages` ที่ active
### 4.2 `POST /shops/{user_id}/package-orders`
```json
{ "package_code": "two_clips_basic", "status": "active", "paid_reference": "manual:2026-10-31 โอนเข้าบัญชี", "note": "ลูกค้าเก่า" }
```
→ `201 { "package_order": { "id": "…", "clips_included": 2, "revisions_per_clip": 2, "expires_at": "…" } }`
> การตรวจการจ่ายเงินอยู่นอก scope (สลิปถูกตัดออก) เดิมทีจะให้ admin หรือ grokbot ระบุ `paid_reference` เอง

### 4.3 `POST /package-check` — ถามก่อนรับงาน (ไม่มีผลข้างเคียง)
```json
{ "shop_user_id": "6a1d…", "request_id": "c0ffee…", "ask": { "kind": "revision" } }
```
```json
{ "within_package": false, "reason": "over_revisions", "clips_left": 0, "revisions_left": 0,
  "suggest_review_type": "out_of_package" }
```

---

## 5. งานวิดีโอจาก LINE

### 5.1 `POST /requests` — สร้าง request
```json
{
  "shop_user_id": "6a1d…",
  "package_order_id": "9b2e…",
  "external_ref": "gb-job-20261031-0042",
  "brief": {
    "title": "เมนูใหม่ ข้าวซอยไก่",
    "description": "อยากได้คลิปแนะนำเมนูใหม่ เน้นน้ำแกงเข้มข้น",
    "language": "th",
    "caption_languages": ["th", "en"],
    "duration_seconds": 20,
    "platforms": ["tiktok", "instagram"],
    "voice": { "enabled": true, "voice_id": "th_female_warm" },
    "customer_text": "อยากให้มีราคา 89 บาทด้วยนะคะ"
  },
  "files": [
    { "client_file_id": "line-msg-55501", "file_name": "IMG_2231.MOV", "mime": "video/quicktime", "size_bytes": 84512300 },
    { "client_file_id": "line-msg-55502", "file_name": "IMG_2232.JPG", "mime": "image/jpeg", "size_bytes": 3120400 }
  ]
}
```
`201`
```json
{
  "request": { "id": "c0ffee…", "status": "draft", "intake_channel": "line", "render_lane": "operator_pc" },
  "uploads": [
    { "client_file_id": "line-msg-55501", "asset_id": "a1…", "put_url": "https://…digitaloceanspaces.com/request_mat/…?X-Amz-…",
      "headers": { "Content-Type": "video/quicktime", "x-amz-acl": "private" }, "expires_at": "…+15m" }
  ]
}
```
ข้อจำกัด: ไฟล์ละไม่เกิน 500 MB, สูงสุด 20 ไฟล์ และใช้ mime ตาม allow-list ของ `localMediaPolicy` · `external_ref` ซ้ำจะได้ `200` พร้อม request เดิม

### 5.2 `POST /requests/{id}/submit`
`{ "uploaded_asset_ids": ["a1…", "a2…"] }` → RClipper ตรวจว่าไฟล์อยู่จริง (HEAD) ทำ QC แล้วเริ่ม pipeline → `202 { "job_id": "…", "step": "analyzing_content" }`
- QC ไม่ผ่าน → สร้าง review item `footage_qc` แล้วส่ง webhook `review.created`
- ใช้ `clip` จากแพ็กเกจ 1 หน่วย (`package_usage`) ถ้าแพ็กเกจหมดจะสร้าง `out_of_package` แทนการปฏิเสธทันที

### 5.3 `GET /requests/{id}` — สถานะ pipeline + open review items + deliverables (signed URL)
### 5.4 `POST /requests/{id}/revision` — ร้านขอแก้หลังส่งงานแล้ว
`{ "customer_text": "ขอเปลี่ยนเพลงเป็นสนุก ๆ", "scope_hint": "music" }` → ถ้ายังอยู่ในโควตาแก้ไข ระบบจะเปิด gate ใหม่ (`reopenDeviceProductionByRequester` หรือเทียบเท่า) + `package_usage(kind=revision)` ถ้าเกินโควตาจะสร้าง `out_of_package` แล้วตอบ `202 { "review_item": {…} }`

---

## 6. Review items

### 6.1 `POST /reviews/evaluate` — dry-run: ต้องรีวิวไหม (ไม่บันทึกอะไร)
```json
{
  "type": "customer_reply",
  "shop_user_id": "6a1d…",
  "draft": { "text": "ข้าวซอยไก่ราคา 89 บาทค่ะ ส่งคลิปให้ภายในพรุ่งนี้นะคะ" },
  "customer_text": "ราคาเท่าไหร่คะ แล้วได้คลิปเมื่อไหร่",
  "signals": { "confidence": 0.93, "intent": "question", "sentiment": 0.1, "tags": ["price"] },
  "producer": { "agent": "grokbot", "provider": "xai", "model": "grok-4", "prompt_version": "reply-v12" }
}
```
```json
{
  "outcome": "needs_review",
  "matched_rules": [{ "key": "menu_price_promo", "kind": "hard", "reason_th": "คลิปมีชื่อเมนู ราคา หรือโปรโมชัน" }],
  "explain": "hard rule matched; confidence 0.93 ignored"
}
```
`outcome` เป็นได้ 3 ค่า: `auto_send` | `needs_review` | `handoff_human`

### 6.2 `POST /reviews` — สร้าง review item (สำหรับ type ที่ไม่ได้มาจาก gate)
body เหมือน 6.1 แต่เพิ่ม `title`, `external_ref`, `request_id?`, `assets?`
- `201 { "outcome": "needs_review", "item": ReviewItem }`
- `200 { "outcome": "auto_send", "item": ReviewItem }` (item สร้างด้วย status `approved`, `decided_via=auto` เพื่อใช้เป็น audit)
- `201 { "outcome": "handoff_human", "item": … }` grokbot **ต้องหยุดตอบร้านคนนั้น** จนได้ `review.decided`

> type `video`/`tts`/`script`/`caption` ที่เกิดจาก gate ของ pipeline นั้น **RClipper สร้างเอง** (hook H1) grokbot ไม่ต้องเรียก แต่จะได้ webhook `review.created`

### 6.3 `GET /reviews?status=pending&type=video&shop_user_id=…&cursor=…` — คิว (สำหรับหน้าในแอป Grokbot)
### 6.4 `GET /reviews/{id}` (หรือใช้ `short_code` ก็ได้) — รายละเอียด + preview links

### 6.5 `POST /reviews/{id}/opened` — บันทึกว่าเปิดการ์ด (ใช้คำนวณ `decision_seconds`)
`{ "actor": { "admin_ref": "joe" }, "opened_at": "2026-10-31T07:11:40Z" }` → `204` (เรียกซ้ำได้ ระบบเก็บเฉพาะครั้งแรก)

### 6.6 `POST /reviews/{id}/decision` — ตัดสิน
```json
{
  "expected_version": 1,
  "actor": { "admin_ref": "joe" },
  "decision": "approve",
  "client_elapsed_ms": 14200
}
```
`decision`:

| ค่า | ฟิลด์เพิ่ม | ผล |
|---|---|---|
| `approve` | – | `approved` → applyDecision (pipeline เดินต่อ / ส่งข้อความตามร่าง) |
| `reject` | `reason_code` (บังคับ), `reason_text?`, `next?: "regenerate" \| "ask_customer" \| "stop"` | `rejected` |
| `edit` | `edits: [{ "field": "script.th", "value": "…" }]`, `reason_code` (บังคับ), `rerender?: true` | `edited` (+ `render_state=queued` ถ้า re-render) |
| `manual_reply` | `reply_text` (≤ 2000), `reason_code?` | `edited` + `resolution=manual_reply` → grokbot ส่งข้อความนี้ตามตัวอักษร |
| `take_over` | `note?` | (complaint) `edited` + `resolution=handoff_taken` บอทหยุดตอบจนกว่า admin จะกด `release` |
| `release_handoff` | – | ปล่อยให้บอทกลับมาตอบร้านต่อ |
| `accept_extra` | `extra_price_baht`, `message_to_shop?` | (out_of_package) `approved` + `package_usage(kind=extra)` |

`200`
```json
{
  "item": { "id": "…", "short_code": "K7Q2MD", "status": "edited", "render_state": "queued", "version": 1 },
  "effects": [
    { "kind": "rerender_queued", "render_task_id": "…", "eta_minutes": 6 }
  ]
}
```
Error ที่พบบ่อย: `409 item_not_pending`, `409 version_conflict`, `403 actor_not_admin`, `422 validation_failed`

### 6.7 การตอบกลับแบบสั้นในแชต (quick reply)
ปุ่มในการ์ดส่ง `decision` ตรง ๆ ส่วนถ้า Joe พิมพ์ตอบเป็นข้อความ grokbot แปลงตามไวยากรณ์นี้ (ทั้งหมดไม่สนตัวพิมพ์เล็ก/ใหญ่ และใช้ได้ทั้งมี/ไม่มี `#`):

| ข้อความ | แปลงเป็น |
|---|---|
| `ok K7Q2MD` / `อนุมัติ K7Q2MD` / `👍` (ตอบกลับที่การ์ด) | `approve` |
| `no K7Q2MD ราคาผิด` | `reject` + `reason_code` จาก keyword map (`ราคา→wrong_price`, `เมนู→wrong_menu_name`, `สะกด→thai_spelling`, ไม่ตรงอะไรเลย→`other`) |
| `reply K7Q2MD <ข้อความ>` / `ตอบ K7Q2MD <ข้อความ>` | `manual_reply` |
| `edit K7Q2MD` | grokbot ตอบลิงก์ไปหน้าเว็บ (การแก้ข้อความยาวหรือ re-render ทำที่เว็บ) |

### 6.8 `GET https://app.rclipper.com/r/{token}` (อยู่นอก base path) — preview
ไม่ต้องใช้ HMAC แต่ token ต้องถูกต้อง → `302` ไป Spaces presigned GET (TTL 5 นาที) ถ้าหมดอายุหรือถูกถอนจะ `302` ไป `/admin/review/{id}` (ต้อง login)

---

## 7. Webhook events (RClipper → grokbot)

ทุก event มี envelope:
```json
{
  "event_id": "5d0f…",
  "type": "review.created",
  "created_at": "2026-10-31T07:05:12Z",
  "data": { }
}
```

### 7.1 `review.created`
```json
{
  "type": "review.created",
  "data": {
    "item": {
      "id": "3c7e…", "short_code": "K7Q2MD", "type": "video", "status": "pending", "version": 1,
      "title": "วิดีโอหลัก 9:16 · ข้าวซอยไก่",
      "shop": { "user_id": "6a1d…", "name": "ครัวป้าแดง สาขานิมมาน", "line_user_id": "U4af…" },
      "reasons": [
        { "key": "menu_price_promo", "kind": "hard", "text": "คลิปมีชื่อเมนู ราคา หรือโปรโมชัน", "evidence": "\"ราคา 89 บาท\" ในซับ 0:07" }
      ],
      "confidence": 0.71,
      "summary": { "duration_s": 20, "ratio": "9:16", "caption_preview": "ข้าวซอยไก่ น้ำแกงเข้มข้น เพียง 89 บาท", "voice": true },
      "preview": { "url": "https://app.rclipper.com/r/eyJ…", "expires_at": "…+30m", "poster_url": "https://app.rclipper.com/r/eyK…" },
      "web_url": "https://app.rclipper.com/admin/review/3c7e…",
      "quick_actions": ["approve", "reject", "open_web"],
      "complexity": "simple",
      "due_at": "2026-11-01T07:05:12Z",
      "package": { "code": "two_clips_basic", "clips_left": 1, "revisions_left": 2 }
    },
    "card": { "template": "video.v1", "lang": "th", "text": "…ข้อความการ์ดที่ render แล้ว (ดู NOTIFICATION_TEMPLATES.md)…" }
  }
}
```
- `complexity`: `simple` (ตัดสินในแชตได้) | `complex` (ควรเปิดเว็บ) คำนวณจาก type + จำนวนกฎ + มี edit field ไหม
- `card.text` เป็นข้อความที่ render แล้ว **เผื่อ** grokbot อยากแสดงตรง ๆ แต่ grokbot render เองจาก `item` ก็ได้

### 7.2 `review.updated` — version ใหม่หลัง re-render, หรือมีการเปลี่ยนแปลงจากเว็บ
### 7.3 `review.reminder` — `{ item, reminder_count, overdue: false }`
### 7.4 `review.decided`
```json
{
  "type": "review.decided",
  "data": {
    "item": { "id": "3c7e…", "short_code": "K7Q2MD", "status": "approved", "resolution": "approved", "version": 1 },
    "decided_via": "web",
    "actions_for_bot": [
      { "kind": "send_message", "to_line_user_id": "U4af…", "text": "วิดีโอพร้อมแล้วค่ะ 🎬", "after": "delivery.ready" }
    ]
  }
}
```
`actions_for_bot` บอก grokbot ว่าต้องทำอะไรต่อ (`send_message`, `stop_bot`, `resume_bot`, `ask_customer`, `none`) เพื่อไม่ให้ grokbot ต้องเดาจากสถานะ

### 7.5 `review.expired` — `{ item, actions_for_bot: [{kind:"send_message", text:"…ขออภัย…"}] }`
### 7.6 `shop.notice_in_review` — ถึงเวลา X นาทีแล้ว ให้แจ้งร้าน
```json
{ "type": "shop.notice_in_review",
  "data": { "item_id": "3c7e…", "to_line_user_id": "U4af…", "eta": "2026-11-01T07:00:00Z",
            "eta_text_th": "พรุ่งนี้ก่อน 14:00 น.", "text": "…ดู template S1…" } }
```
### 7.7 `shop.notice_overdue` — เลย `due_at` (ส่งครั้งเดียว)
### 7.8 `delivery.ready`
```json
{ "type": "delivery.ready",
  "data": { "request_id": "c0ffee…", "to_line_user_id": "U4af…",
            "files": [{ "ratio": "9:16", "url": "https://app.rclipper.com/r/eyD…", "expires_at": "…+7d", "size_bytes": 18233411, "mime": "video/mp4" }],
            "captions": { "th": "…", "en": "…" } } }
```

---

## 8. ตัวอย่างลำดับเรียก (happy path)

```
grokbot  POST /shops/resolve                       → user_id
grokbot  POST /shops/{id}/package-orders           → package_order_id (ครั้งแรก)
grokbot  POST /requests                            → request_id + put_urls
grokbot  PUT  <put_url> × n                        (Spaces, private)
grokbot  POST /requests/{id}/submit                → 202
RClipper webhook review.created (script)           → การ์ดในแอป
grokbot  POST /reviews/{id}/opened
grokbot  POST /reviews/{id}/decision {approve}     → pipeline เดินต่อ
RClipper webhook review.created (video)
grokbot  POST /reviews/{id}/decision {approve}
RClipper webhook review.decided + delivery.ready   → grokbot ส่งวิดีโอเข้า LINE
```

## 9. Versioning
- path มี `/v1` · เพิ่มฟิลด์ใหม่ได้โดยไม่ bump version (grokbot ต้องไม่ error เมื่อเจอฟิลด์ที่ไม่รู้จัก) · ถ้าเปลี่ยนความหมายหรือลบฟิลด์ต้องทำ `/v2` และเปิด v1 ไว้คู่กันอย่างน้อย 30 วัน
- ทุก webhook มี `schema: "rc.review.v1"` ใน envelope

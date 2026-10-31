# UI wireframe — /admin/review (mobile-first)

ความกว้างเป้าหมาย 390 px (iPhone) · ใช้ Tailwind + `AdminShell` เดิม · ป้ายบนหน้าเว็บเป็นภาษาอังกฤษตามหน้า admin อื่น แต่ **ข้อความของร้าน/ร่างของ AI แสดงเป็นภาษาไทยตามจริง**
ปุ่มกดสูงอย่างน้อย 44 px · แถบปุ่มติดล่างจอ (`position: sticky; bottom: 0` + `env(safe-area-inset-bottom)`) · input font 16 px (กัน iOS zoom ตาม invariant เดิม)

ไฟล์ (Phase 2–3): `src/app/(auth)/admin/review/page.tsx`, `[id]/page.tsx`, `rules/page.tsx`, `trust/page.tsx`, `stats/page.tsx` · คอมโพเนนต์อยู่ที่ `src/features/admin/review/*`

---

## 1. Queue — `/admin/review`

```
┌──────────────────────────────────────┐
│ ☰  Review                    🔔 3    │
├──────────────────────────────────────┤
│ [Pending 7] [Edited 2] [Done] [All]  │  ← segmented, จำค่าไว้ใน localStorage
│ Type ▾  Shop ▾  🔴 Overdue only ☐    │
├──────────────────────────────────────┤
│ 🔴 OVERDUE 2h                        │
│ 🚨 ครัวป้าแดง · #P3XK9A   Complaint  │
│ "ทำไมยังไม่ได้คลิปคะ รอมา 2 วันแล้ว" │
│ Customer unhappy · Human asked       │
│ [Take over]            [Open ›]      │
├──────────────────────────────────────┤
│ ⏳ due in 3h                          │
│ 🎬 ครัวป้าแดง · #K7Q2MD   Video v1    │
│ ┌────────┐ Menu/price/promo          │
│ │ poster │ "89 บาท" in subtitle 0:07 │
│ │  9:16  │ AI 71% · 20s              │
│ └────────┘                           │
│ [✓ Approve]  [✕]        [Open ›]     │  ← Approve เร็วจากคิว เฉพาะ complexity=simple
├──────────────────────────────────────┤
│ ⏳ due in 20h                         │
│ 🗨️ กาแฟบ้านสวน · #Q8M2RT  Reply       │
│ C: "เปิดกี่โมงคะ"                     │
│ Bot: "เปิด 8 โมงถึง 5 โมงเย็นค่ะ"      │
│ Low AI confidence (62%)              │
│ [✓ Send]  [✎ Reply myself] [Open ›]  │
├──────────────────────────────────────┤
│            Load more                 │
└──────────────────────────────────────┘
```
- เรียง: `expired`/overdue → `complaint` → `due_at` ใกล้ก่อน → `priority`
- ปุ่ม Approve ในคิวต้องยืนยันด้วย **undo toast 5 วิ** (“Approved #K7Q2MD · Undo”) แทนการใช้ dialog เพราะ dialog ทำให้ช้าและ `alert/confirm` บล็อก WebView · ระบบส่งคำสั่งจริงหลังครบ 5 วิ
- poll ทุก 15 วิ เมื่อหน้าเปิดอยู่ (`visibilitychange`) · badge 🔔 นับ pending
- ว่าง: “Nothing to review 🎉 · Last decision 12 min ago”

## 2. Item — `/admin/review/[id]` (ตัวอย่างประเภท video)

```
┌──────────────────────────────────────┐
│ ‹ Queue      #K7Q2MD · v1    ⏳ 3h    │
├──────────────────────────────────────┤
│ 🎬 Video · ครัวป้าแดง สาขานิมมาน       │
│ Package: 2 clips · 1 left · 2 edits  │
├──────────────────────────────────────┤
│ WHY HERE                              │
│ ● Menu / price / promo   (hard)       │
│   "89 บาท" — subtitle 0:07  [jump ▶]  │
│ ○ AI confidence 71% < 80%             │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │                                  │ │
│ │         video preview            │ │  ← <video playsinline controls>
│ │            9:16                  │ │     src = /r/<token> (signed)
│ │                                  │ │
│ └──────────────────────────────────┘ │
│ [Output] [Source footage (4)] [A|B]   │  ← A|B = เทียบ v ก่อนหน้า (เมื่อ v>1)
├──────────────────────────────────────┤
│ AI DRAFT                     ✎ Edit  │
│ Script (TH)                          │
│ ข้าวซอยไก่ น้ำแกงเข้มข้น เพียง 89 บาท  │
│ Subtitles  th · en         (6 cues)  │
│ 0:00 ครัวป้าแดง ...                   │
│ 0:07 เพียง 89 บาท  ← highlighted      │
│ Caption (post)                       │
│ ข้าวซอยไก่ เมนูใหม่ ...  #เชียงใหม่     │
├──────────────────────────────────────┤
│ CUSTOMER ASKED                       │
│ "อยากให้มีราคา 89 บาทด้วยนะคะ"         │
│ via LINE · 31 Oct 10:42              │
├──────────────────────────────────────┤
│ TIMELINE                        ▾    │
│ 10:58 created (rules: menu_price…)   │
│ 10:58 notified grokbot_app           │
│ 11:11 opened (web)                   │
├──────────────────────────────────────┤
│▓▓▓▓▓▓▓▓▓▓▓▓▓ sticky ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ [✓ Approve]  [✎ Edit]  [✕ Reject] [⋯]│  ← ⋯ = Reply to shop myself
└──────────────────────────────────────┘
```

### 2.1 Edit (inline → re-render)
```
│ AI DRAFT                     ✓ Done  │
│ Subtitle 0:07                        │
│ ┌──────────────────────────────────┐ │
│ │ เพียง 99 บาท                      │ │  ← textarea 16px, นับตัวอักษร/บรรทัด
│ └──────────────────────────────────┘ │
│ Why the change? (required)           │
│ (wrong price) (menu name) (spelling) │  ← chips = reason_code
│ (too long) (tone) (other…)           │
│ Note (optional) ____________________ │
│ ☑ Re-render video after saving       │
│ [Save & re-render]   [Cancel]        │
```
- กดบันทึกแล้วสถานะเป็น `edited · render queued` → แถบความคืบหน้า (poll `render_state`) → เสร็จแล้ว v2 เข้าคิว (ถ้ากฎยังบังคับ) พร้อมแท็บ **A|B** ให้เทียบ
- field ที่แก้ได้มาจาก `ReviewTypeHandler.editableFields` (script th/en, subtitle cue, post caption, reply text)
- diff ที่บันทึก = `{field, before, after}` ต่อช่อง

### 2.2 Reject
```
│ Reject #K7Q2MD                        │
│ Reason (required)                     │
│ (wrong price) (bad footage) (shot order)│
│ (voice) (subtitles) (off-brand) (other)│
│ Note ______________________________   │
│ Then:                                 │
│ ◉ Regenerate (AI tries again)         │
│ ○ Ask the shop (bot sends a question) │
│ ○ Stop this job                       │
│ [Reject]                              │
```

### 2.3 Reply to shop myself (`manual_reply`)
```
│ Reply to ครัวป้าแดง                    │
│ Bot draft:  "ราคา 89 บาทค่ะ ..."  [Use draft as start]│
│ ┌──────────────────────────────────┐ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
│ Sent exactly as typed via LINE.      │
│ [Send]                               │
```

### 2.4 ส่วนที่ต่างกันตาม type
| type | preview | ส่วนเฉพาะ |
|---|---|---|
| `tts` | `<audio>` + waveform ง่าย ๆ + ความยาวเทียบสตอรีบอร์ด | ปุ่ม Regenerate voice (เลือกเสียง) |
| `script` | ภาพ poster ของแต่ละฉาก (grid 2 คอลัมน์) | แก้บท th/en |
| `caption` | ข้อความ + จำนวนตัวอักษร/แพลตฟอร์ม | แก้ inline |
| `customer_reply` | บับเบิลแชต 5 ข้อความล่าสุด | Send / Reply myself / Take over |
| `out_of_package` | การ์ดแพ็กเกจ + ประวัติ `package_usage` | ช่องราคา + Accept / Free / Decline |
| `complaint` | บับเบิลแชต + งานล่าสุดของร้าน | **Take over** (บอทหยุด) / Release |
| `footage_qc` | grid ไฟล์ต้นฉบับ + ป้ายปัญหาต่อไฟล์ | Continue with usable / Ask for new |

### 2.5 สถานะที่ปิดแล้ว (อ่านอย่างเดียว / ตรวจย้อนหลัง)
แถบปุ่มจะเปลี่ยนเป็นป้าย “Approved by Joe via Grokbot app · 11:12 · 14 s” และยังเปิดดู timeline, diff, version เดิมได้ · item ที่ auto-approve จะมีปุ่ม **“Flag: should have been reviewed”** (บันทึก `comment` + ใช้นับใน circuit breaker)

## 3. Rules — `/admin/review/rules`
```
│ Rules                       [+ New]  │
│ HARD (always wins over AI confidence)│
│ ● wants_human        🔒 locked  ON  │
│ ● customer_unhappy   🔒 locked  ON  │
│ ● out_of_package     🔒 locked  ON  │
│ ● footage_qc_failed             ON  │
│ ● menu_price_promo              ON  │
│ ● first_jobs_of_shop  (<3)      ON  │
│ THRESHOLD                            │
│ ● low_confidence   0.80  [per type ▸]│
│ SAMPLING                             │
│ ● sampling  (uses trust policies)    │
```
หน้าแก้กฎ: ฟอร์ม `any/all` + แถวเงื่อนไข (signal ▾, op ▾, value) · **“Test against last 50 items”** แสดงว่าเคสไหนจะเปลี่ยนผลลัพธ์ก่อนบันทึก · ทุกครั้งที่บันทึก version จะเพิ่มขึ้น 1

## 4. Trust — `/admin/review/trust`
ตารางร้าน: งาน 30 วัน · % แก้ · complaint · สถานะ auto · ปุ่ม Enable (ตั้ง sample rate, min confidence, types) · ป้าย “disabled by circuit breaker 31 Oct”

## 5. Stats — `/admin/review/stats`
tiles: median `decision_seconds` (เป้า ≤ 30 วิ) · median wait · % ที่เลยกำหนด · % edited/rejected ต่อ type · ความแม่นของ auto (sampled pass rate) · top 10 `reason_code` (ลิงก์ไป export CSV จาก `review_feedback_export`) · แยกตาม `provider/model/prompt_version`

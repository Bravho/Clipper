# Implementation plan — Admin Review System

**หลักร่วมทุก phase**
- deploy ทีละ phase ได้ทุกครั้ง และงาน studio/แอปเดิม **ต้องทำงานเหมือนเดิม** · ทุกอย่างใหม่อยู่หลัง flag `REVIEW_SYSTEM_ENABLED` / `LINE_INTAKE_ENABLED` (อ่านตอน request ไม่ใช่ตอน build เหมือน `studioRollout.ts`)
- ทุก hook ในโค้ดเดิมต้อง **เช็ก `intake_channel === 'line'` ก่อนทำอะไร** และห่อด้วย try/catch (ถ้า review ล้มเหลว gate เดิมต้องยังอยู่ ไม่ทำให้ pipeline พัง)
- migration แบบ additive + idempotent (เลข 048 ขึ้นไป) · ไม่ลบไฟล์ ถ้ามีไฟล์ที่เลิกใช้ให้ย้ายไป `_to_delete/`
- repo pattern เดิม: interface → Postgres + Mock → ลงทะเบียนใน `src/repositories/index.ts` ที่เดียว · test ใช้ `new Map()` mock
- ไม่มีการแก้ native code และไม่ต้องสร้าง app build ใหม่ในทุก phase (ทั้งหมดเป็น server/web)
- ตรวจในแต่ละ phase: `npx tsc --noEmit`, `npx next lint`, `npx jest` ส่วน failure เดิมที่รู้อยู่แล้วยังเหมือนเดิม (VideoGenerationService overlay, RequestPresentationService ×3, remotion)

ลำดับ: **P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7** (P2 กับ P3 ทำคู่กันได้)

---

## P0 · Contract freeze (เอกสารเท่านั้น)
- ตกลง API.md v1 กับฝั่ง grokbot · สร้าง secret 2 ตัว (`GROKBOT_HMAC_KEYS`, `GROKBOT_WEBHOOK_SECRET`) และ `GROKBOT_WEBHOOK_URL` (Mar-PC ต้องเปิดรับ webhook ได้ทาง tunnel เช่น Cloudflare Tunnel เพราะ PC ไม่มี IP สาธารณะ)
- **AC:** grokbot ทำ mock server ตาม §7 ได้ · ตัวอย่าง HMAC (test vector) ตรงกันทั้งสองฝั่ง

## P1 · Review core: ข้อมูล + RuleEngine (ยังไม่มี UI หรือ API ภายนอก)
**สร้าง**
- `src/db/migrations/048_review_core.sql` (§1, §5–§11 ของ SCHEMA.sql)
- `src/domain/models/ReviewItem.ts`, `ReviewAction.ts`, `EscalationRule.ts`, `ReviewTrustPolicy.ts`, `ReviewOutboxEvent.ts`
- `src/repositories/interfaces/I{ReviewItem,ReviewAction,EscalationRule,ReviewTrust,ReviewOutbox}Repository.ts` + `postgres/*` + `mock/*`
- `src/services/review/RuleEngine.ts` (pure: `evaluate(signals, rules, typeCfg, trust) → {outcome, matched, trace}`), `ruleDsl.ts` (Zod schema + evaluator, จำกัด regex ≤ 300 ตัวอักษร)
- `src/services/review/ReviewService.ts` (create / open / decide / expire, เขียน action + outbox ใน transaction เดียว)
- `src/services/review/types/*.ts` (handler ทั้ง 8 type: validate + summarize ก่อน, ส่วน applyDecision เป็น stub)
- `src/config/reviewSystem.ts` (flags, locked rule keys, reason_code list)
- tests: `tests/services/review/RuleEngine.test.ts` (**hard rule ชนะ confidence 0.99**, locked rule ไม่ถูก bypass แม้ trusted, sampling deterministic), `ReviewService.test.ts` (state machine, version_conflict, duplicate gate → 1 item)

**แก้:** `src/repositories/index.ts` (ลงทะเบียน repo ใหม่)
**AC:** migration รัน 2 รอบไม่ error (ทดสอบด้วย PGlite/Postgres 16) · test ผ่าน · ไม่มีโค้ดเดิมไหนเรียก service ใหม่

## P2 · Integration API + webhook outbox
**สร้าง**
- `src/app/api/integrations/grokbot/_guard.ts` (HMAC, skew, key rotation, rate limit), `_idempotency.ts`
- `v1/reviews/route.ts` (GET list, POST create), `v1/reviews/evaluate/route.ts`, `v1/reviews/[id]/route.ts`, `[id]/opened/route.ts`, `[id]/decision/route.ts`
- `src/services/review/notifiers/{GrokbotAppNotifier,WebPushNotifier}.ts` + `ReviewOutboxDispatcher.ts`
- `src/services/review/templates/th.ts` (การ์ด A1–A12, ข้อความ S1–S9)
- `scripts/review-worker.ts` (dispatcher + SLA sweep ทุก 1 นาที, ใช้ `FOR UPDATE SKIP LOCKED`) + `scripts/run-review-worker.sh` (cron/pm2 บน droplet)
- `src/app/r/[token]/route.ts` (preview redirect, jose JWT, revocation)
- tests: guard (signature ผิด, skew, replay), idempotency (key เดียวกันแต่ body ต่าง → 422), outbox retry/backoff, template snapshot

**AC:** type `customer_reply` ใช้ได้ครบวงจรกับ grokbot: evaluate → create → การ์ดในแอป → decision → `review.decided` · webhook ล่มแล้วกลับมาได้รับครบไม่ซ้ำ · `curl` ที่ไม่มีลายเซ็นได้ 401 · ยังไม่แตะ pipeline วิดีโอ

## P3 · หน้าเว็บ /admin/review (mobile-first)
**สร้าง**
- `src/app/(auth)/admin/review/page.tsx`, `[id]/page.tsx`
- `src/app/api/admin/review/route.ts`, `[id]/route.ts`, `[id]/decision/route.ts`, `[id]/opened/route.ts` (ใช้ `requireRole(Admin)` แล้วเรียก ReviewService ตัวเดียวกับ grokbot)
- `src/features/admin/review/{ReviewQueue,ReviewCard,ReviewItemView,ActionBar,EditPanel,RejectSheet,ReplySheet,Timeline,MediaPreview,UndoToast}.tsx`
**แก้:** `src/config/adminNav.ts` (กลุ่ม Review), `src/config/routes.ts` (`ADMIN_REVIEW*`)
**AC:** ที่ 390 px ตัดสิน `customer_reply` ได้ใน ≤ 3 แตะ · ตัดสินที่เว็บแล้วการ์ดในแอป Grokbot อัปเดต (A11) · ตัดสินซ้ำจากสองที่ → ที่สองได้ 409 และ UI แสดงผลที่ตัดสินแล้ว · ผู้ใช้ที่ไม่ใช่ admin ถูก redirect (middleware เดิม) · Playwright screenshot 390 px

## P4 · LINE intake + render lane บน Mar-PC
**สร้าง**
- `src/db/migrations/049_line_intake.sql` (§2, §4 ของ SCHEMA.sql)
- `src/services/line/LineShopService.ts` (resolve/create requester + business_profile, link code)
- `v1/shops/resolve`, `v1/shops/link-code`, `v1/shops/[id]`, `v1/requests` (POST), `v1/requests/[id]/submit`, `v1/requests/[id]` (GET)
- `src/app/(auth)/account/link-line/page.tsx` (ร้านกรอกโค้ด 6 หลัก)
- `src/services/review/FootageQcService.ts` (ffprobe: ความยาว ความละเอียด rotation ความสว่างเฉลี่ยจาก poster) → item `footage_qc`
- `scripts/render-worker.ts` รองรับ `RENDER_LANE=operator_pc` (อ่าน env แล้วส่งไป `claimNext(lane)`) + `docs/mar-pc-worker-setup.md` (Windows: Node 24, ffmpeg, Chromium ของ Remotion, `.env.local`)
**แก้ (จุดเล็ก มี flag)**
- `PostgresRenderTaskRepository.claimNext` (+ interface/mock): param `lane?` · Mac Mini ส่ง `undefined` แล้ว SQL ต้องเพิ่ม `AND render_lane IS DISTINCT FROM 'operator_pc'` เพื่อไม่ให้แย่งงาน LINE
- จุด enqueue render task: ใส่ `render_lane` ตาม `clip_requests.render_lane`
- path อัปโหลดของงาน LINE: `acl: "private"` (H4) · การอ่านไฟล์ต้นฉบับของ worker ใช้ signed URL แทน public URL เฉพาะเมื่อ `intake_channel='line'`

**AC:** request จาก LINE เดินจนได้วิดีโอ final บน Mar-PC (gate ยังให้ admin กดผ่าน API ชั่วคราว) · ไฟล์ทุกตัวของงาน LINE เปิดด้วย URL สาธารณะไม่ได้ (ได้ 403) · Mac Mini (ถ้าเปิดอยู่) ไม่ claim งาน LINE · งาน studio ไม่เปลี่ยน (`render_lane IS NULL`) · test claimNext lane

## P5 · Hook gates ของ pipeline → review item อัตโนมัติ
**สร้าง:** `src/services/review/ReviewGateHook.ts` (`onGate(job, step)`), `ReviewDecisionExecutor.ts` (เรียก `…ByRequester` แทนร้าน), signal collector (รวม script/ซับ/แคปชันเป็น `text`, ผล QC, ข้อมูลแพ็กเกจ, `shop.completed_jobs`)
**แก้:** `VideoGenerationService` — เรียก `reviewGateHook.onGate` ที่ **จุดเดียว** หลังบันทึก step `awaiting_*` (จุดเดียวกับที่ dispatch push notice) โดยมี guard `intake_channel==='line' && REVIEW_SYSTEM_ENABLED` · handler `video/tts/script/caption` ทำ applyDecision จริง + re-render (`rerender_requested` → render_task → `review.updated` v+1)
**AC:** งาน LINE ที่มี "89 บาท" ในซับต้องสร้าง item `video` ทุกครั้งแม้ confidence = 0.99 · approve ที่การ์ดแล้ว pipeline เดินต่อเอง · แก้ซับ → re-render → v2 → approve → `delivery.ready` · gate ซ้ำไม่สร้างการ์ดซ้ำ · **regression:** test เดิมของ VideoGenerationService ยังผ่านเท่าเดิม และ studio request ไม่สร้าง review item

## P6 · แพ็กเกจ + นอกแพ็กเกจ + SLA ครบชุด
**สร้าง:** `src/db/migrations/050_service_packages.sql` (§3), `PackageService.ts` (นับจาก `package_usage`), `v1/packages`, `v1/shops/[id]/package-orders`, `v1/package-check`, `v1/requests/[id]/revision`, handler `out_of_package` (accept_extra/free/decline) · SLA เต็มรูปแบบ: customer notice X นาที, reminder รวบเป็นรอบ, quiet hours, overdue, expired
**AC:** แพ็กเกจ 2 คลิป/แก้ 2 ครั้ง: คลิปที่ 3 หรือการแก้ครั้งที่ 3 → `out_of_package` (ล็อก bypass ไม่ได้) · ไม่ตอบ 15 นาที → ร้านได้ S1 ครั้งเดียว · เลย 24 ชม. → S2 + การ์ดแดง · 72 ชม. → expired และไม่ส่งงานให้ร้านเอง · test กับนาฬิกาปลอม

## P7 · Rules UI, Trust/auto-approve, Stats
**สร้าง:** `/admin/review/rules` (+ "Test against last 50"), `/admin/review/trust`, `/admin/review/stats`, CSV export จาก `review_feedback_export`, circuit breaker ใน `ReviewService` (หลัง decision ของ item `sampled`)
**AC:** แก้ threshold ได้จากหน้าเว็บโดยไม่ต้อง deploy · เปิด trust ให้ร้าน A แล้ว ≈ (1 − sample_rate) ของงานที่ไม่มี hard rule ผ่านอัตโนมัติ · งานของร้าน A ที่มีราคาในคลิปยังต้องรีวิว · sampled ถูก reject 2/10 → ปิด trust เอง + แจ้ง A12 · stats แสดง median decision_seconds ถูกต้อง (เทียบกับ SQL ที่คำนวณเอง)

---

## Rollout
1. P1 deploy (มีแค่ตาราง ไม่มีพฤติกรรมใหม่) → `node scripts/apply-migration.js …048…`
2. P2 + P3 deploy, `REVIEW_SYSTEM_ENABLED=true` → ลองกับ `customer_reply` อย่างเดียวก่อน 1 สัปดาห์
3. P4 deploy (`LINE_INTAKE_ENABLED=true` เฉพาะร้านทดลอง 1–2 ร้าน ผ่าน allow-list `LINE_INTAKE_SHOPS`) + ติดตั้ง worker บน Mar-PC
4. P5 → P6 → P7 · เริ่มด้วยการรีวิวทุกงาน (`low_confidence` threshold = 1.0) แล้วค่อยลดเมื่อมี stats พอ
5. Rollback ต่อ phase: ปิด flag ได้ทันที (gate เดิมยังรอให้กดผ่าน `…ByRequester` จาก API ได้) · ตารางใหม่ทิ้งไว้ได้ ไม่กระทบระบบเดิม

## ความเสี่ยงที่ต้องดู
- **Mar-PC เป็นจุดเดียวที่ล่มได้** (grokbot + worker + LINE) เพราะ outbox/SLA อยู่ที่ server ไม่มีงานหาย แต่ร้านจะไม่ได้ข้อความจนกว่า PC จะกลับมา → ควรตั้ง monitor heartbeat ของ PC (ใช้ `render_worker_heartbeat` เดิม) และ web push หา admin
- `VideoGenerationService` ใหญ่มาก (5.5k บรรทัด) จึงต้องเพิ่ม hook ที่จุดเดียวและมี test regression
- render บน Windows ยังไม่เคยทดสอบ (path, ฟอนต์ไทยใน Chromium) → P4 เริ่มจาก `--once` กับงานทดสอบก่อน
- ข้อมูลส่วนตัว: LINE userId + ข้อความลูกค้าเป็นข้อมูลส่วนบุคคล (PDPA) จึงเก็บตาม retention เดิม (`config/retention.ts`) และเพิ่มในนโยบายความเป็นส่วนตัว

/**
 * LINE webhook HMAC-SHA256 signature verification and deterministic state machine.
 *
 * Security: rejects 401 if X-Line-Signature is missing or invalid.
 * Never throws on unknown message types — gracefully ignores them.
 *
 * State machine transitions:
 *   idle               → (start_job)    → awaiting_package_choice
 *   awaiting_package_choice → (package name) → awaiting_brief
 *   awaiting_brief     → (text)         → awaiting_files
 *   awaiting_files     → (image/video)  → awaiting_files (accumulates)
 *   awaiting_files     → (confirm)      → creates ClipRequest, submits, in_progress
 *   in_progress        → (status)       → replies with job status
 *   * wants_human / unknown → escalates to review queue
 */

import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { ILineClient, LineMessage } from '@/lib/line/ILineClient';
import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { getShopVoiceParticle } from '@/config/lineIntake';
import { PACKAGES, findPackageByCode } from '@/config/stripePackages';
import { uploadLineAsset } from '@/lib/line/lineStorage';
import {
  MAX_REVISIONS_PER_CLIP,
  MAX_CLIP_DURATION_SECONDS,
} from '@/config/reviewSystem';

// ── Signature verification ───────────────────────────────────────────────────

/**
 * Verify LINE webhook X-Line-Signature header.
 * Returns true if signature matches base64(HMAC-SHA256(secret, rawBody)).
 */
export function verifyLineSignature(
  rawBody: Buffer,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');
  try {
    const providedBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

// ── State machine ────────────────────────────────────────────────────────────

/** Conversation states. */
export type ConvState =
  | 'idle'
  | 'greeting'
  | 'awaiting_package_choice'
  | 'awaiting_brief'
  | 'awaiting_files'
  | 'in_progress'
  | 'awaiting_review';

/** Routine steps the server handles itself; escalated steps go to the review queue. */
const ROUTINE_INTENTS = new Set([
  'greeting',
  'package_info',
  'status',
  'review_prompt',
  'help',
]);

// ── Thai message templates ────────────────────────────────────────────────────

function greetingMsg(particle: string): string {
  return `สวัสดี${particle} ยินดีต้อนรับสู่บริการตัดต่อวิดีโออัตโนมัติ 🎬\nพิมพ์ "แพ็กเกจ" เพื่อดูราคา หรือพิมพ์ "เริ่มงาน" เพื่อเริ่มสั่งงาน${particle}`;
}

function packageInfoMsg(particle: string): string {
  return `แพ็กเกจของเรา${particle} 📦\n• Trial 299 บาท — 2 คลิป\n• Starter 1,490 บาท — 8 คลิป\n• Growth 2,690 บาท — 12 คลิป\n• Pro 4,290 บาท — 16 คลิป\nทุกแพ็กเกจแก้ได้ ${MAX_REVISIONS_PER_CLIP} ครั้งต่อคลิป · วิดีโอสูงสุด ${MAX_CLIP_DURATION_SECONDS} วินาที\nพิมพ์ชื่อแพ็กเกจที่ต้องการ${particle}`;
}

function helpMsg(particle: string): string {
  return `คำสั่งที่ใช้ได้${particle} 💬\n• "แพ็กเกจ" — ดูราคาและสิทธิ์\n• "เริ่มงาน" — สั่งงานใหม่\n• "สถานะ" — ดูความคืบหน้า\n• "ติดต่อ" — คุยกับทีมงาน`;
}

function statusMsg(particle: string): string {
  return `กำลังตรวจสอบสถานะงานของคุณ${particle} กรุณารอสักครู่ 🔍`;
}

function unknownMsg(particle: string): string {
  return `ขออภัย${particle} ไม่เข้าใจคำสั่ง 😅 พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งทั้งหมด`;
}

function escalateMsg(particle: string): string {
  return `รับทราบ${particle} 🙏 ทีมงานจะดูแลให้โดยเร็ว`;
}

function packageChoiceMsg(particle: string, pkgName: string, paymentUrl: string): string {
  return `ยอดเยี่ยม${particle} คุณเลือก ${pkgName} 🎉\nกรุณาชำระเงินผ่านลิงก์นี้:\n${paymentUrl}\nหลังชำระเงินแล้วระบบจะอัปเดตอัตโนมัติ${particle}`;
}

function briefPromptMsg(particle: string): string {
  return `การชำระเงินสำเร็จแล้ว${particle} 🎊\nกรุณาบอกรายละเอียดร้านค้าของคุณ:\n• ชื่อร้าน\n• สินค้า/บริการหลัก\n• กลุ่มลูกค้าเป้าหมาย\n• สไตล์วิดีโอที่ต้องการ`;
}

function filesPromptMsg(particle: string): string {
  return `ขอบคุณ${particle} 📝 ได้รับรายละเอียดแล้ว\nกรุณาส่งรูปภาพหรือวิดีโอสำหรับตัดต่อ (ส่งได้สูงสุด 20 ไฟล์)\nเมื่อส่งครบแล้วพิมพ์ "ยืนยัน" เพื่อส่งงาน${particle}`;
}

function fileReceivedMsg(particle: string, count: number): string {
  return `รับไฟล์แล้ว${particle} (${count} ไฟล์)\nส่งไฟล์เพิ่มได้ หรือพิมพ์ "ยืนยัน" เพื่อส่งงาน${particle}`;
}

function jobSubmittedMsg(particle: string, requestId: string): string {
  return `ส่งงานสำเร็จแล้ว${particle} 🚀\nหมายเลขงาน: ${requestId}\nทีมงานจะเริ่มดำเนินการ และแจ้งผลให้ทราบทาง LINE${particle}`;
}

// ── Intent classifier ────────────────────────────────────────────────────────

/** Classify incoming text into an intent. */
export function classifyIntent(text: string): string {
  const t = text.trim().toLowerCase();
  if (/^(สวัสดี|หวัดดี|ดีจ้า|ฮัลโหล|hi|hello)/.test(t)) return 'greeting';
  if (/แพ็กเกจ|ราคา|package|price/.test(t)) return 'package_info';
  if (/สถานะ|ความคืบหน้า|งานไปถึงไหน|status/.test(t)) return 'status';
  if (/ช่วยเหลือ|help|คำสั่ง/.test(t)) return 'help';
  if (/เริ่มงาน|สั่งงาน|ทำวิดีโอ/.test(t)) return 'start_job';
  if (/ยืนยัน|อนุมัติ|โอเค|ok|ตกลง/.test(t)) return 'confirm';
  if (/คุยกับ(?:คน|แอดมิน|เจ้าหน้าที่)|ขอสายคน|human/.test(t)) return 'wants_human';
  // Package name matching
  for (const pkg of PACKAGES) {
    if (t.includes(pkg.code) || t.includes(pkg.nameTh.split(' ')[0].toLowerCase())) {
      return `choose_package:${pkg.code}`;
    }
  }
  return 'unknown';
}

export interface LineWebhookEvent {
  type: string;
  webhookEventId?: string;
  message?: { type: string; text?: string; id?: string };
  replyToken?: string;
  source?: { userId?: string };
}

export interface ProcessWebhookOptions {
  lineChannelId: string;
  lineClient: ILineClient;
  lineAccountRepo: ILineAccountRepository;
  reviewMessages?: (lineUserId: string) => Promise<LineMessage[]>;
  choosePackage?: (lineUserId: string, code: string) => Promise<{ orderId: string; paymentUrl: string }>;
  isPaid?: (orderId: string, lineUserId: string) => Promise<boolean>;
  /** Optional: needed for media download. Only inject in the real route, not tests. */
  fetchMediaContent?: (messageId: string) => Promise<{ buffer: Buffer; contentType: string }>;
  /** Optional: create review item for escalations. */
  createReviewItem?: (opts: { lineUserId: string; text: string; intent: string }) => Promise<void>;
  /** Optional: create + submit clip request when user confirms. */
  submitClipRequest?: (opts: {
    lineUserId: string;
    context: Record<string, unknown>;
  }) => Promise<{ requestId: string }>;
}

/**
 * Process a single LINE webhook event.
 *
 * Routine steps are answered immediately via the reply token.
 * Unrecognised/escalated events are recorded for the review queue.
 * All errors are caught so the webhook always returns 200.
 */
export async function processLineEvent(
  event: LineWebhookEvent,
  opts: ProcessWebhookOptions
): Promise<{ escalated: boolean; intent: string }> {
  const particle = getShopVoiceParticle();
  const lineUserId = event.source?.userId;
  if (!lineUserId) return { escalated: false, intent: 'no_user' };

  const replyToken = event.replyToken;

  // ── Non-text messages: check current state for file collection ────────────
  if (event.type === 'message' && event.message?.type !== 'text') {
    const convState = await opts.lineAccountRepo.getConversationState(
      opts.lineChannelId, lineUserId
    );
    const state = convState?.state ?? 'idle';

    if (state === 'awaiting_files' && (event.message?.type === 'image' || event.message?.type === 'video')) {
      const messageId = event.message?.id;
      if (messageId && opts.fetchMediaContent) {
        try {
          const { buffer, contentType } = await opts.fetchMediaContent(messageId);
          const key = `line_uploads/${opts.lineChannelId}/${lineUserId}/${messageId}.${event.message?.type === 'video' ? 'mp4' : 'jpg'}`;
          await uploadLineAsset({ key, body: buffer, contentType });

          const context = { ...(convState?.context ?? {})} as Record<string, unknown>;
          const files = (context['files'] as string[] | undefined) ?? [];
          if (files.length >= 20) throw new Error('file_limit');
          files.push(key);
          context['files'] = files;
          await opts.lineAccountRepo.upsertConversationState(
            opts.lineChannelId, lineUserId, 'awaiting_files', context
          );
          if (replyToken) {
            await opts.lineClient.reply(replyToken, [
              { type: 'text', text: fileReceivedMsg(particle, files.length) },
            ]);
          }
          return { escalated: false, intent: 'file_received' };
        } catch (err) {
          console.error('[LINE] media download failed:', err);
          return { escalated: false, intent: 'file_error' };
        }
      }
    }

    return { escalated: false, intent: 'non_text' };
  }

  if (event.type !== 'message' || event.message?.type !== 'text') {
    return { escalated: false, intent: 'non_text' };
  }

  const text = event.message.text ?? '';
  const intent = classifyIntent(text);

  // ── Load current conversation state ────────────────────────────────────────
  const convState = await opts.lineAccountRepo.getConversationState(
    opts.lineChannelId, lineUserId
  );
  const state = convState?.state ?? 'idle';
  const context = { ...(convState?.context ?? {}) } as Record<string, unknown>;

  // ── Routine intents (always handled regardless of state) ──────────────────
  if (ROUTINE_INTENTS.has(intent)) {
    if (intent === 'status' && opts.reviewMessages) {
      const messages = await opts.reviewMessages(lineUserId);
      if (messages.length) {
        if (replyToken) await opts.lineClient.reply(replyToken, messages);
        return { escalated: false, intent };
      }
    }
    let reply: string;
    switch (intent) {
      case 'greeting':      reply = greetingMsg(particle);    break;
      case 'package_info':  reply = packageInfoMsg(particle); break;
      case 'status':        reply = statusMsg(particle);      break;
      case 'help':          reply = helpMsg(particle);        break;
      default:              reply = unknownMsg(particle);
    }
    if (replyToken) {
      await opts.lineClient.reply(replyToken, [{ type: 'text', text: reply }]);
    }
    return { escalated: false, intent };
  }

  // ── wants_human: instant reply + escalate ─────────────────────────────────
  if (intent === 'wants_human') {
    if (replyToken) {
      await opts.lineClient.reply(replyToken, [
        { type: 'text', text: escalateMsg(particle) },
      ]);
    }
    if (opts.createReviewItem) {
      await opts.createReviewItem({ lineUserId, text, intent });
    }
    return { escalated: true, intent };
  }

  // ── State-specific handling ───────────────────────────────────────────────

  // start_job: begin intake
  if (intent === 'start_job') {
    await opts.lineAccountRepo.upsertConversationState(
      opts.lineChannelId, lineUserId, 'awaiting_package_choice', { intakeId: randomUUID() }
    );
    if (replyToken) {
      await opts.lineClient.reply(replyToken, [
        { type: 'text', text: packageInfoMsg(particle) },
      ]);
    }
    return { escalated: false, intent };
  }

  // Package choice: reply with Stripe payment link
  if (intent.startsWith('choose_package:') && state === 'awaiting_package_choice') {
    const pkgCode = intent.split(':')[1];
    const pkg = findPackageByCode(pkgCode);
    if (pkg) {
      const checkout = opts.choosePackage ? await opts.choosePackage(lineUserId, pkgCode) : undefined;
      context.orderId = checkout?.orderId;
      context['package_code'] = pkgCode;
      context['package_name'] = pkg.nameTh;
      await opts.lineAccountRepo.upsertConversationState(
        opts.lineChannelId, lineUserId, 'awaiting_payment', context
      );
      if (replyToken) {
        await opts.lineClient.reply(replyToken, [
          { type: 'text', text: packageChoiceMsg(particle, pkg.nameTh, checkout?.paymentUrl ?? pkg.paymentLinkUrl) },
        ]);
      }
      return { escalated: false, intent };
    }
  }

  if (state === 'awaiting_payment') {
    if (!opts.isPaid || !await opts.isPaid(String(context.orderId), lineUserId)) {
      if (replyToken) await opts.lineClient.reply(replyToken, [{ type: 'text', text: '??????????????????? ?????????????????????????' }]);
      return { escalated: false, intent: 'payment_pending' };
    }
    await opts.lineAccountRepo.upsertConversationState(opts.lineChannelId, lineUserId, 'awaiting_brief', context);
    if (replyToken) await opts.lineClient.reply(replyToken, [{ type: 'text', text: briefPromptMsg(particle) }]);
    return { escalated: false, intent: 'payment_confirmed' };
  }
  if (state === 'awaiting_storyboard_preference' || state === 'awaiting_voice_preference') {
    const yes = /^(yes|\u0e43\u0e0a\u0e48|\u0e15\u0e49\u0e2d\u0e07\u0e01\u0e32\u0e23)$/i.test(text.trim());
    const no = /^(no|\u0e44\u0e21\u0e48|\u0e44\u0e21\u0e48\u0e15\u0e49\u0e2d\u0e07\u0e01\u0e32\u0e23)$/i.test(text.trim());
    if (yes || no) {
      const storyboard = state === 'awaiting_storyboard_preference';
      context[storyboard ? 'reviewStoryboard' : 'reviewVoice'] = yes;
      await opts.lineAccountRepo.upsertConversationState(opts.lineChannelId, lineUserId,
        storyboard ? 'awaiting_voice_preference' : 'awaiting_files', context);
      if (replyToken) await opts.lineClient.reply(replyToken, [{ type: 'text', text: storyboard ?
        '\u0e15\u0e23\u0e27\u0e08\u0e40\u0e2a\u0e35\u0e22\u0e07 (.mp4 + script)? yes / no' : filesPromptMsg(particle) + '\n\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19 = \u0e22\u0e34\u0e19\u0e22\u0e2d\u0e21 AI \u0e41\u0e25\u0e30\u0e23\u0e31\u0e1a\u0e23\u0e2d\u0e07\u0e2a\u0e34\u0e17\u0e18\u0e34\u0e4c\u0e44\u0e1f\u0e25\u0e4c' }]);
      return { escalated: false, intent: 'review_preference' };
    }
  }
  // Brief collection: awaiting_brief state → collect text as brief
  if (state === 'awaiting_brief') {
    context['brief'] = text;
    await opts.lineAccountRepo.upsertConversationState(
      opts.lineChannelId, lineUserId, 'awaiting_storyboard_preference', context
    );
    if (replyToken) {
      await opts.lineClient.reply(replyToken, [
        { type: 'text', text: '\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e15\u0e2d\u0e23\u0e35\u0e1a\u0e2d\u0e23\u0e4c\u0e14? yes / no' },
      ]);
    }
    return { escalated: false, intent: 'brief_collected' };
  }

  // Confirm: awaiting_files → create and submit clip request
  if (intent === 'confirm' && state === 'awaiting_files') {
    const files = (context['files'] as string[] | undefined) ?? [];
    if (files.length === 0) {
      if (replyToken) {
        await opts.lineClient.reply(replyToken, [
          { type: 'text', text: `กรุณาส่งไฟล์อย่างน้อย 1 ไฟล์ก่อนยืนยัน${particle}` },
        ]);
      }
      return { escalated: false, intent: 'confirm_no_files' };
    }

    if (opts.submitClipRequest) {
      try {
        const { requestId } = await opts.submitClipRequest({ lineUserId, context });
        await opts.lineAccountRepo.upsertConversationState(
          opts.lineChannelId, lineUserId, 'in_progress', { requestId }
        );
        if (replyToken) {
          await opts.lineClient.reply(replyToken, [
            { type: 'text', text: jobSubmittedMsg(particle, requestId) },
          ]);
        }
        return { escalated: false, intent: 'job_submitted' };
      } catch (err) {
        console.error('[LINE] submitClipRequest failed:', err);
        if (replyToken) {
          await opts.lineClient.reply(replyToken, [
            { type: 'text', text: `เกิดข้อผิดพลาด กรุณาลองใหม่หรือติดต่อทีมงาน${particle}` },
          ]);
        }
        return { escalated: false, intent: 'submit_error' };
      }
    }
    return { escalated: false, intent: 'confirm' };
  }

  // Unknown in any other state: escalate
  if (opts.createReviewItem) {
    await opts.createReviewItem({ lineUserId, text, intent });
  }
  if (replyToken) {
    await opts.lineClient.reply(replyToken, [
      { type: 'text', text: unknownMsg(particle) },
    ]);
  }
  return { escalated: true, intent: 'unknown' };
}

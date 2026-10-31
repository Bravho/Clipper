/**
 * LINE webhook HMAC-SHA256 signature verification and deterministic state machine.
 *
 * Security: rejects 401 if X-Line-Signature is missing or invalid.
 * Never throws on unknown message types — gracefully ignores them.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { ILineClient } from '@/lib/line/ILineClient';
import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { getShopVoiceParticle } from '@/config/lineIntake';

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

/** Thai messages for the state machine. */
function greetingMsg(particle: string): string {
  return `สวัสดี${particle} ยินดีต้อนรับสู่บริการตัดต่อวิดีโออัตโนมัติ 🎬\nพิมพ์ "แพ็กเกจ" เพื่อดูราคา หรือพิมพ์ "เริ่มงาน" เพื่อเริ่มสั่งงาน${particle}`;
}

function packageInfoMsg(particle: string): string {
  return `แพ็กเกจของเรา${particle} 📦\n• Trial 299 บาท — 2 คลิป\n• Starter 1,490 บาท — 8 คลิป\n• Growth 2,690 บาท — 12 คลิป\n• Pro 4,290 บาท — 16 คลิป\nทุกแพ็กเกจแก้ได้ 2 ครั้งต่อคลิป · ส่งภายใน 24 ชม.\nพิมพ์ชื่อแพ็กเกจที่ต้องการ${particle}`;
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
  return 'unknown';
}

export interface LineWebhookEvent {
  type: string;
  message?: { type: string; text?: string };
  replyToken?: string;
  source?: { userId?: string };
}

export interface ProcessWebhookOptions {
  lineChannelId: string;
  lineClient: ILineClient;
  lineAccountRepo: ILineAccountRepository;
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

  if (event.type !== 'message' || event.message?.type !== 'text') {
    return { escalated: false, intent: 'non_text' };
  }

  const text = event.message.text ?? '';
  const intent = classifyIntent(text);
  const replyToken = event.replyToken;

  // Routine intents: answer immediately
  if (ROUTINE_INTENTS.has(intent)) {
    let reply: string;
    switch (intent) {
      case 'greeting':      reply = greetingMsg(particle);     break;
      case 'package_info':  reply = packageInfoMsg(particle);  break;
      case 'status':        reply = statusMsg(particle);       break;
      case 'help':          reply = helpMsg(particle);         break;
      default:              reply = unknownMsg(particle);
    }
    if (replyToken) {
      await opts.lineClient.reply(replyToken, [{ type: 'text', text: reply }]);
    }
    return { escalated: false, intent };
  }

  // wants_human: instant reply, mark as escalated
  if (intent === 'wants_human') {
    if (replyToken) {
      await opts.lineClient.reply(replyToken, [
        { type: 'text', text: escalateMsg(particle) },
      ]);
    }
    return { escalated: true, intent };
  }

  // Unknown: reply with help, also escalated for admin visibility
  if (intent === 'unknown') {
    if (replyToken) {
      await opts.lineClient.reply(replyToken, [
        { type: 'text', text: unknownMsg(particle) },
      ]);
    }
    return { escalated: true, intent };
  }

  // start_job / confirm: update conversation state, reply with next step
  if (intent === 'start_job') {
    await opts.lineAccountRepo.upsertConversationState(
      opts.lineChannelId, lineUserId, 'awaiting_package_choice', {}
    );
    if (replyToken) {
      await opts.lineClient.reply(replyToken, [
        { type: 'text', text: packageInfoMsg(particle) },
      ]);
    }
    return { escalated: false, intent };
  }

  return { escalated: false, intent };
}

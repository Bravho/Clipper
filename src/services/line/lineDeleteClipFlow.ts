/**
 * LINE chat: delete a clip from the shop's request, with a confirmation step.
 * Nothing is deleted on the first message. The shop must reply "ยืนยันลบ" to
 * confirm, or "ยกเลิก" to cancel. Pure logic over injected functions (tested).
 */

export const DELETE_CONFIRM_STATE = 'awaiting_delete_confirm';

export interface DeleteClipDeps {
  /** `url` is an expiring private link so the shop can check the clip first. */
  listClips(requestId: string): Promise<{ id: string; url?: string }[]>;
  removeClip(requestId: string, clipId: string): Promise<void>;
}

export interface DeleteClipInput {
  text: string;
  state: string;
  context: Record<string, unknown>;
  deps: DeleteClipDeps;
}

export type DeleteClipStep =
  | { handled: false }
  | { handled: true; reply: string; nextState: string; nextContext: Record<string, unknown> };

/** Does the shop's text ask to delete a clip? */
export function isDeleteClipText(text: string): boolean {
  const t = text.trim();
  return /ลบ/.test(t) && /คลิป|วิดีโอ|ไฟล์/.test(t) && !/ยืนยัน/.test(t);
}

function revert(context: Record<string, unknown>): { nextState: string; nextContext: Record<string, unknown> } {
  const previous = typeof context.previousState === 'string' ? context.previousState : 'in_progress';
  const { previousState: _p, pendingDeleteIds: _ids, ...rest } = context;
  void _p;
  void _ids;
  return { nextState: previous, nextContext: rest };
}

export async function runDeleteClipStep(input: DeleteClipInput): Promise<DeleteClipStep> {
  const { text, state, context, deps } = input;
  const t = text.trim();

  // Waiting for the shop's answer to the confirmation question.
  if (state === DELETE_CONFIRM_STATE) {
    const requestId = String(context.requestId ?? '');
    const ids = Array.isArray(context.pendingDeleteIds) ? (context.pendingDeleteIds as string[]) : [];
    if (/ยกเลิก/.test(t)) {
      const back = revert(context);
      return { handled: true, reply: 'ยกเลิกแล้วค่ะ ยังไม่ได้ลบคลิปนะคะ', ...back };
    }
    if (/ยืนยันลบ/.test(t)) {
      try {
        for (const id of ids) await deps.removeClip(requestId, id);
      } catch {
        return {
          handled: true,
          reply: 'ลบคลิปไม่สำเร็จค่ะ ลองพิมพ์ "ลบคลิปเก่า" อีกครั้งนะคะ',
          nextState: DELETE_CONFIRM_STATE,
          nextContext: context,
        };
      }
      const back = revert(context);
      return { handled: true, reply: `ลบคลิปเก่า ${ids.length} คลิปแล้วค่ะ ส่งคลิปใหม่หรือบอกรายละเอียดงานได้เลยค่ะ`, ...back };
    }
    return {
      handled: true,
      reply: 'ถ้าต้องการลบคลิปเก่า พิมพ์ "ยืนยันลบ" ค่ะ ถ้าไม่ต้องการพิมพ์ "ยกเลิก" ค่ะ',
      nextState: DELETE_CONFIRM_STATE,
      nextContext: context,
    };
  }

  if (!isDeleteClipText(t)) return { handled: false };

  const requestId = String(context.requestId ?? '');
  if (!requestId) {
    return { handled: true, reply: 'ตอนนี้ยังไม่มีงานให้ลบคลิปนะคะ', nextState: state, nextContext: context };
  }
  const clips = await deps.listClips(requestId);
  if (clips.length === 0) {
    return { handled: true, reply: 'ตอนนี้ไม่มีคลิปให้ลบค่ะ', nextState: state, nextContext: context };
  }
  const links = clips.map((c, i) =>
    c.url ? `คลิปที่ ${i + 1}: ${c.url}` : `คลิปที่ ${i + 1}: (เปิดดูลิงก์ไม่ได้ตอนนี้)`
  );
  return {
    handled: true,
    reply:
      `ต้องการลบคลิปเก่า ${clips.length} คลิปใช่ไหมคะ? ลบแล้วกู้คืนไม่ได้ค่ะ\n` +
      `ดูคลิปก่อนได้ที่ลิงก์นี้ (หมดอายุใน 30 นาที)\n${links.join('\n')}\n` +
      `พิมพ์ "ยืนยันลบ" เพื่อลบ หรือ "ยกเลิก" เพื่อไม่ลบ`,
    nextState: DELETE_CONFIRM_STATE,
    nextContext: { ...context, previousState: state, pendingDeleteIds: clips.map((c) => c.id) },
  };
}

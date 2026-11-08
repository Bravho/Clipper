import { LineClient } from '@/lib/line/LineClient';
import { lineAccountRepository, clipRequestRepository } from '@/repositories';

const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID ?? 'default';
const RETRY_QUESTION = 'ขออภัยค่ะ ระบบยังไม่พบสถานที่นี้ กรุณาพิมพ์ชื่อสถานที่ให้ชัดเจนอีกครั้ง (เช่น ชื่อร้านและย่าน) 🙏';

/**
 * Ask the shop once for a clearer place name after the first lookup failed.
 * Sets the conversation to awaiting_place_retry so the shop's next text is taken
 * as the new place name. Pushes one LINE message (Tho approved option A).
 */
export async function notifyLocationRetry(requestId: string): Promise<void> {
  const request = await clipRequestRepository.findById(requestId);
  if (!request) return;
  const account = (await lineAccountRepository.findByUserId(request.userId))
    .find(a => a.lineChannelId === LINE_CHANNEL_ID);
  if (!account) return;
  await lineAccountRepository.upsertConversationState(
    LINE_CHANNEL_ID, account.lineUserId, 'awaiting_place_retry', { requestId }
  );
  await new LineClient().push(account.lineUserId, [{ type: 'text', text: RETRY_QUESTION }], 'loc-retry:' + requestId);
}

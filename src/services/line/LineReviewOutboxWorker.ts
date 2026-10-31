import { IReviewOutboxRepository } from '@/repositories/interfaces/IReviewOutboxRepository';
import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { ILineClient } from '@/lib/line/ILineClient';
import { spacesSignedUrl } from '@/lib/spaces';
// Routine prompts are deliberately excluded. Shops request review links with
// their next status message, which is answered with a reply token.
export async function processLineReviewOutbox(deps: {
  outbox: IReviewOutboxRepository; items: IReviewItemRepository;
  accounts: ILineAccountRepository; client: ILineClient;
  execute: (itemId: string) => Promise<void>;
}): Promise<void> {
  const event = await deps.outbox.claimNext();
  if (!event) return;
  try {
    if (event.reviewItemId && ['review.decided','review.edited'].includes(event.eventType)) {
      await deps.execute(event.reviewItemId);
      const item = await deps.items.findById(event.reviewItemId);
      if (item) {
        const accounts = await deps.accounts.findByUserId(item.shopUserId);
        for (const account of accounts.filter(account => account.status === 'active')) {
          await deps.client.push(account.lineUserId, [{ type: 'text',
            text: String(item.finalPayload?.reply_text ?? `Review ${item.shortCode}: ${item.status}`) }], event.eventId);
        }
      }
    }
    if (event.eventType === 'line.delivery') {
      const accounts = await deps.accounts.findByUserId(String(event.payload.user_id));
      const url = await spacesSignedUrl(String(event.payload.storage_key), 1800);
      for (const account of accounts.filter(account => account.status === 'active')) {
        await deps.client.push(account.lineUserId, [{ type: 'text', text: `วิดีโอพร้อมแล้ว: ${url}` }], event.eventId);
      }
    }
    await deps.outbox.markSent(event.id);
  } catch (error) {
    await deps.outbox.markFailed(event.id, String(error));
  }
}

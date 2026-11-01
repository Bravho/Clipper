import { notifyGrokBot } from '@/services/review/GrokBotNotifier';
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
    if (event.eventType === 'storyboard.render') {
      const { dispatchStoryboardVersion } = await import('./lineSceneEditRuntime');
      await dispatchStoryboardVersion(String(event.payload.version_id));
      await deps.outbox.markSent(event.id);
      return;
    }
    if (event.eventType === 'review.created') {
      const item = event.reviewItemId ? await deps.items.findById(event.reviewItemId) : null;
      if (!item) throw new Error('review_item_missing');
      await notifyGrokBot(item, { signedUrl: spacesSignedUrl, throwOnFailure: true,
        event: ['customer_reply', 'complaint', 'out_of_package'].includes(item.typeKey) ? 'escalation' : 'review_needed' });
    } else if (event.eventType === 'takeover_on') {
      // Generic event contains no LINE identity or raw customer text.
      await notifyGrokBot({ id: event.eventId, shortCode: '', typeKey: 'customer_reply',
        requestId: null, packageOrderId: null, payload: {}, assetRefs: [], signals: {} },
        { signedUrl: spacesSignedUrl, event: 'takeover_on', throwOnFailure: true });
    } else if (!['review.decided', 'review.edited', 'line.delivery'].includes(event.eventType)) {
      throw new Error('unsupported_outbox_event:' + event.eventType);
    }
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

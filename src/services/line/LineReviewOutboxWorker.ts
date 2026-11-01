import { notifyGrokBot } from '@/services/review/GrokBotNotifier';
import { IReviewOutboxRepository } from '@/repositories/interfaces/IReviewOutboxRepository';
import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { ILineClient } from '@/lib/line/ILineClient';
import { spacesSignedUrl } from '@/lib/spaces';
import { hasActiveTakeover } from './lineTakeover';
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
    const item = event.reviewItemId ? await deps.items.findById(event.reviewItemId) : null;
    // Only an explicit human reply may bypass takeover. It never runs automation.
    const manualReply = event.eventType === 'review.decided' && event.payload.decision === 'manual_reply'
      && item?.resolution === 'manual_reply'
      && ['web', 'grokbot_app'].includes(item.decidedVia ?? '') && typeof item.finalPayload?.reply_text === 'string';
    const userId = item?.shopUserId ?? (typeof event.payload.user_id === 'string' ? event.payload.user_id : null);
    const accounts = userId ? await deps.accounts.findByUserId(userId) : [];
    if (['review.decided', 'review.edited', 'line.delivery', 'storyboard.voice'].includes(event.eventType)
        && !manualReply && await hasActiveTakeover(deps.accounts, accounts)) {
      await deps.outbox.defer(event.id, new Date(Date.now() + 5 * 60_000));
      return;
    }
    if (event.eventType === 'storyboard.voice') {
      const { videoGenerationService } = await import('@/services/VideoGenerationService');
      await videoGenerationService.runStoryboardVoiceTask(String(event.payload.job_id), String(event.payload.version_id));
      await deps.outbox.markSent(event.id);
      return;
    }
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
      if (!manualReply) await deps.execute(event.reviewItemId);
      const item = await deps.items.findById(event.reviewItemId);
      if (item) {
        const accounts = await deps.accounts.findByUserId(item.shopUserId);
        if (!manualReply && await hasActiveTakeover(deps.accounts, accounts)) throw new Error('takeover');
        for (const account of accounts.filter(account => account.status === 'active')) {
          await deps.client.push(account.lineUserId, [{ type: 'text',
            text: String(item.finalPayload?.reply_text ?? `Review ${item.shortCode}: ${item.status}`) }], event.eventId);
        }
      }
    }
    if (event.eventType === 'line.delivery') {
      const accounts = await deps.accounts.findByUserId(String(event.payload.user_id));
      const url = await spacesSignedUrl(String(event.payload.storage_key), 1800);
      if (await hasActiveTakeover(deps.accounts, accounts)) throw new Error('takeover');
      for (const account of accounts.filter(account => account.status === 'active')) {
        await deps.client.push(account.lineUserId, [{ type: 'text', text: `วิดีโอพร้อมแล้ว: ${url}` }], event.eventId);
      }
    }
    await deps.outbox.markSent(event.id);
  } catch (error) {
    if (error instanceof Error && error.message === 'takeover') {
      await deps.outbox.defer(event.id, new Date(Date.now() + 5 * 60_000));
    } else await deps.outbox.markFailed(event.id, String(error));
  }
}

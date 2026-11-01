import { notifyGrokBot, resolveGrokBotWebhookAuth } from '@/services/review/GrokBotNotifier';
import { IReviewOutboxRepository } from '@/repositories/interfaces/IReviewOutboxRepository';
import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { ILineClient } from '@/lib/line/ILineClient';
import { spacesSignedUrl } from '@/lib/spaces';
import { hasActiveTakeover } from './lineTakeover';
import { takeoverActive, inScope, positiveLimit } from './lineHandoffPolicy';
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
    if (event.eventType === 'line.reply') {
      const account = await deps.accounts.findById(String(event.payload.lineAccountId));
      if (!account || !inScope(account) || account.status !== 'active') {
        await deps.outbox.markDead(event.id); return;
      }
      if (takeoverActive(account)
          && (event.payload.actor !== 'human' || event.payload.allowDuringTakeover !== true)) {
        await deps.outbox.markFailed(event.id, 'takeover_active');
        await deps.outbox.markDead(event.id); return;
      }
      await deps.client.push(account.lineUserId, [{ type: 'text', text: String(event.payload.text) }], event.eventId);
      await deps.outbox.markSent(event.id); return;
    }
    const item = event.reviewItemId ? await deps.items.findById(event.reviewItemId) : null;
    // Only an explicit human reply may bypass takeover. It never runs automation.
    const manualReply = event.eventType === 'review.decided' && event.payload.decision === 'manual_reply'
      && item?.resolution === 'manual_reply'
      && ['web', 'grokbot_app'].includes(item.decidedVia ?? '') && typeof item.finalPayload?.reply_text === 'string';
    const userId = item?.shopUserId ?? (typeof event.payload.user_id === 'string' ? event.payload.user_id : null);
    const accounts = userId ? await deps.accounts.findByUserId(userId) : [];
    if (manualReply && event.payload.allowDuringTakeover !== true && accounts.some(takeoverActive)) {
      await deps.outbox.markFailed(event.id, 'takeover_active');
      await deps.outbox.markDead(event.id); return;
    }
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
    if (event.eventType === 'review.created' || event.eventType === 'handoff.escalate') {
      const item = event.reviewItemId ? await deps.items.findById(event.reviewItemId) : null;
      if (!item) throw new Error('review_item_missing');
      const escalation = event.eventType === 'handoff.escalate' || ['customer_reply', 'complaint', 'out_of_package'].includes(item.typeKey);
      if (item.typeKey === 'customer_reply' && !resolveGrokBotWebhookAuth().configured) {
        await deps.outbox.defer(event.id, new Date(Date.now()+60000));
        return;
      }
      const limited = escalation && await deps.outbox.countEscalations(item.shopUserId, new Date(Date.now()-60000))
        >= positiveLimit('LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN', 6);
      if (limited) {
        await deps.outbox.defer(event.id, new Date(Date.now()+60000));
        return;
      }
      await notifyGrokBot(item, { signedUrl: spacesSignedUrl, throwOnFailure: true,
        event: escalation ? 'escalation' : 'review_needed' });
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
        for (const account of accounts.filter(account => account.status === 'active' && inScope(account))) {
          await deps.client.push(account.lineUserId, [{ type: 'text',
            text: String(manualReply ? event.payload.reply_text ?? item.finalPayload?.reply_text :
              item.finalPayload?.reply_text ?? `Review ${item.shortCode}: ${item.status}`) }], event.eventId);
        }
      }
    }
    if (event.eventType === 'line.delivery') {
      const accounts = await deps.accounts.findByUserId(String(event.payload.user_id));
      const url = await spacesSignedUrl(String(event.payload.storage_key), 1800);
      if (await hasActiveTakeover(deps.accounts, accounts)) throw new Error('takeover');
      for (const account of accounts.filter(account => account.status === 'active' && inScope(account))) {
        await deps.client.push(account.lineUserId, [{ type: 'text', text: `วิดีโอพร้อมแล้ว: ${url}` }], event.eventId);
      }
    }
    await deps.outbox.markSent(event.id);
  } catch (error) {
    if (error instanceof Error && error.message === 'takeover') {
      await deps.outbox.defer(event.id, new Date(Date.now() + 5 * 60_000));
    } else await deps.outbox.markFailed(event.id, 'delivery_failed');
  }
}

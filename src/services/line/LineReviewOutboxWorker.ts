import { notifyGrokBot, resolveGrokBotWebhookAuth } from '@/services/review/GrokBotNotifier';
import { IReviewOutboxRepository } from '@/repositories/interfaces/IReviewOutboxRepository';
import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { ILineClient } from '@/lib/line/ILineClient';
import { spacesSignedUrl } from '@/lib/spaces';
import { hasActiveTakeover } from './lineTakeover';
import { takeoverActive, inScope, positiveLimit } from './lineHandoffPolicy';
import { createHash } from 'crypto';

/**
 * LINE treats a repeated X-Line-Retry-Key as "already accepted" (409), so one
 * key must never be shared by pushes to different recipients. The first
 * recipient keeps the outbox event UUID (unchanged for in-flight retries);
 * further recipients get a stable UUID derived from event + account.
 */
export function recipientRetryKey(eventId: string, accountId: string, index: number): string {
  if (index === 0) return eventId;
  const h = createHash('sha1').update(`${eventId}:${accountId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Thrown when nothing was (or could be) delivered: never mark such a row sent. */
class NoRecipientError extends Error { constructor() { super('no_recipient'); } }
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
      // An unconfigured notifier delivers nothing: keep the row queued (never
      // "sent") so it goes out once GROKBOT_REVIEW_WEBHOOK_* is configured.
      if (!resolveGrokBotWebhookAuth().configured) {
        await deps.outbox.defer(event.id, new Date(Date.now()+60000));
        return;
      }
      // Atomic per-shop cap: reserve the slot before calling the webhook, so
      // concurrent workers cannot both pass a count check.
      const limited = escalation && !(await deps.outbox.reserveEscalationSlot(event.id, item.shopUserId,
        new Date(Date.now()-60000), positiveLimit('LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN', 6)));
      if (limited) {
        await deps.outbox.defer(event.id, new Date(Date.now()+60000));
        return;
      }
      if (!await notifyGrokBot(item, { signedUrl: spacesSignedUrl, throwOnFailure: true,
        event: escalation ? 'escalation' : 'review_needed' })) throw new Error('notifier_not_delivered');
    } else if (event.eventType === 'takeover_on') {
      if (!resolveGrokBotWebhookAuth().configured) {
        await deps.outbox.defer(event.id, new Date(Date.now()+60000));
        return;
      }
      // Generic event contains no LINE identity or raw customer text.
      if (!await notifyGrokBot({ id: event.eventId, shortCode: '', typeKey: 'customer_reply',
        requestId: null, packageOrderId: null, payload: {}, assetRefs: [], signals: {} },
        { signedUrl: spacesSignedUrl, event: 'takeover_on', throwOnFailure: true })) throw new Error('notifier_not_delivered');
    } else if (!['review.decided', 'review.edited', 'line.delivery'].includes(event.eventType)) {
      throw new Error('unsupported_outbox_event:' + event.eventType);
    }
    if (event.reviewItemId && ['review.decided','review.edited'].includes(event.eventType)) {
      if (!manualReply) await deps.execute(event.reviewItemId);
      const item = await deps.items.findById(event.reviewItemId);
      if (!item) throw new NoRecipientError();
      const accounts = await deps.accounts.findByUserId(item.shopUserId);
      if (!manualReply && await hasActiveTakeover(deps.accounts, accounts)) throw new Error('takeover');
      const recipients = accounts.filter(account => account.status === 'active' && inScope(account));
      // A reply that reached nobody is not "sent".
      if (!recipients.length) throw new NoRecipientError();
      for (const [index, account] of recipients.entries()) {
        await deps.client.push(account.lineUserId, [{ type: 'text',
          text: String(manualReply ? event.payload.reply_text ?? item.finalPayload?.reply_text :
            item.finalPayload?.reply_text ?? `Review ${item.shortCode}: ${item.status}`) }],
          recipientRetryKey(event.eventId, account.id, index));
      }
    }
    if (event.eventType === 'line.delivery') {
      const accounts = await deps.accounts.findByUserId(String(event.payload.user_id));
      const url = await spacesSignedUrl(String(event.payload.storage_key), 1800);
      if (await hasActiveTakeover(deps.accounts, accounts)) throw new Error('takeover');
      const recipients = accounts.filter(account => account.status === 'active' && inScope(account));
      if (!recipients.length) throw new NoRecipientError();
      for (const [index, account] of recipients.entries()) {
        await deps.client.push(account.lineUserId, [{ type: 'text', text: `วิดีโอพร้อมแล้ว: ${url}` }],
          recipientRetryKey(event.eventId, account.id, index));
      }
    }
    await deps.outbox.markSent(event.id);
  } catch (error) {
    if (error instanceof Error && error.message === 'takeover') {
      await deps.outbox.defer(event.id, new Date(Date.now() + 5 * 60_000));
    } else if (error instanceof NoRecipientError) {
      // Terminal and visible: retrying cannot find a recipient, and a decided
      // item must not be executed again. Never reported as sent.
      await deps.outbox.markFailed(event.id, 'no_recipient');
      await deps.outbox.markDead(event.id);
    } else await deps.outbox.markFailed(event.id, 'delivery_failed');
  }
}

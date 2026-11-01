import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withLineHandoffTransaction } from '@/repositories';
import { adminAuth, inScope, invalid, notFound, positiveLimit, scopedItem, takeoverActive } from '@/services/line/handoffAdmin';

const schema = z.object({
  itemId: z.string().uuid().optional(), conversationRef: z.string().uuid().optional(),
  text: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/),
  expectedVersion: z.number().int().positive().optional(), resolve: z.boolean().default(false),
  actor: z.enum(['rcavebot', 'human']), allowDuringTakeover: z.boolean().optional(),
}).refine(b => b.itemId || b.conversationRef, 'missing_ids')
  .refine(b => !b.itemId || !b.resolve || b.expectedVersion !== undefined, 'expectedVersion_required');

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = adminAuth(request); if (auth) return auth;
  let raw: unknown;
  try { raw = await request.json(); } catch { return invalid('bad_json'); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues[0].path.join('.') || parsed.error.issues[0].message);
  const b = parsed.data;
  return withLineHandoffTransaction(async ({ createReviewService, lineAccountRepository, reviewItemRepository, reviewOutboxRepository }) => {
    const context = b.itemId ? await scopedItem(b.itemId, reviewItemRepository, lineAccountRepository) : null;
    if (b.itemId && !context) return notFound();
    const account = b.conversationRef ? await lineAccountRepository.findById(b.conversationRef) : context?.account;
    if (!account || !inScope(account) || account.status !== 'active') return notFound();
    if (context && context.account.id !== account.id) return invalid('conversationRef_mismatch');
    const lockedAccounts = lineAccountRepository.lockShop
      ? await lineAccountRepository.lockShop(account.userId) : await lineAccountRepository.findByUserId(account.userId);
    const lockedAccount = lockedAccounts.find(a => a.id === account.id);
    if (!lockedAccount || !inScope(lockedAccount) || lockedAccount.status !== 'active') return notFound();
    const key = 'line.reply:' + b.idempotencyKey;
    const existing = await reviewOutboxRepository.findByDedupeKey(key);
    if (existing) {
      if (existing.payload.lineAccountId !== account.id) return notFound();
      return NextResponse.json({ duplicate: true, outboxEventId: existing.eventId });
    }
    if (takeoverActive(lockedAccount) && (b.actor === 'rcavebot' || b.allowDuringTakeover !== true))
      return NextResponse.json({ error: 'takeover_active' }, { status: 409 });
    if (context && b.resolve && context.item.version !== b.expectedVersion)
      return NextResponse.json({ error: 'version_conflict' }, { status: 409 });
    const recent = await reviewOutboxRepository.listRecentReplies(undefined, new Date(Date.now()-3600000));
    const shop = recent.filter(e => e.payload.lineAccountId === account.id);
    const limited = shop.length >= positiveLimit('LINE_HANDOFF_REPLY_PER_SHOP_PER_HOUR', 20) ? shop
      : recent.length >= positiveLimit('LINE_HANDOFF_REPLY_GLOBAL_PER_HOUR', 200) ? recent : null;
    if (limited) {
      const seconds = Math.max(1, Math.ceil((Math.min(...limited.map(e => e.createdAt.getTime())) + 3600000 - Date.now())/1000));
      return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(seconds) } });
    }
    const event = await reviewOutboxRepository.enqueue({ eventType: 'line.reply', reviewItemId: context?.item.id,
      dedupeKey: key, payload: { lineAccountId: account.id, itemId: context?.item.id ?? null,
        text: b.text, actor: b.actor, shopUserId: account.userId, user_id: account.userId,
        is_test: account.isTest === true, allowDuringTakeover: b.allowDuringTakeover === true,
        resolve: b.resolve, expectedVersion: b.expectedVersion ?? null } });
    if (context && b.resolve) {
      await createReviewService().decide({ itemId: context.item.id, expectedVersion: b.expectedVersion!,
          actorVia: 'grokbot_app', decision: 'manual_reply', replyText: b.text, suppressReplyOutbox: true });
    }
    return NextResponse.json({ queued: true, outboxEventId: event.eventId }, { status: 202 });
  }).catch(error => {
    if ((error as { code?: string }).code === 'version_conflict') return NextResponse.json({ error: 'version_conflict' }, { status: 409 });
    throw error;
  });
}

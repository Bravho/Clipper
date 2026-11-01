import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withLineHandoffTransaction } from '@/repositories';
import { adminAuth, invalid, notFound, scopedItem } from '@/services/line/handoffAdmin';

export async function POST(request: NextRequest, { params }: { params: { itemId: string } }): Promise<NextResponse> {
  const auth = adminAuth(request); if (auth) return auth;
  let raw: unknown; try { raw = await request.json(); } catch { return invalid('bad_json'); }
  const parsed = z.object({ reason: z.string().max(500).optional() }).safeParse(raw);
  if (!parsed.success) return invalid('reason');
  return withLineHandoffTransaction(async ({ reviewItemRepository, reviewOutboxRepository, lineAccountRepository }) => {
  const context = await scopedItem(params.itemId, reviewItemRepository, lineAccountRepository); if (!context) return notFound();
  const { item } = context;
  const key = 'handoff.escalate:' + item.id;
  if (await reviewOutboxRepository.findByDedupeKey(key)) return NextResponse.json({ ok: true, duplicate: true });
  await reviewItemRepository.update(item.id, { signals: { ...item.signals, wants_human: true,
    ...(parsed.data.reason !== undefined ? { escalation_reason: parsed.data.reason } : {}) } });
  await reviewOutboxRepository.enqueue({ eventType: 'handoff.escalate', reviewItemId: item.id, dedupeKey: key,
    payload: { item_id: item.id, shopUserId: item.shopUserId } });
  return NextResponse.json({ ok: true });
  });
}

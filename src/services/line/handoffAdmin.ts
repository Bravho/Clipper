import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { lineAccountRepository, reviewItemRepository } from '@/repositories';
import type { LineAccount } from '@/domain/models/LineAccount';
import type { ReviewItem } from '@/domain/models/ReviewItem';

export function adminAuth(request: NextRequest): NextResponse | null {
  const expected = process.env.REVIEW_ADMIN_TOKEN;
  if (!expected) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(token), b = Buffer.from(expected);
  if (!token || a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return null;
}
export { inScope, takeoverActive, positiveLimit } from './lineHandoffPolicy';
import { inScope } from './lineHandoffPolicy';
export const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const invalid = (detail: string) => NextResponse.json({ error: 'invalid_input', detail }, { status: 400 });
export const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });
export async function itemAccount(item: ReviewItem, accounts = lineAccountRepository): Promise<LineAccount | null> {
  const account = typeof item.payload.lineUserId === 'string'
    ? await accounts.findByLineUser(process.env.LINE_CHANNEL_ID ?? 'default', item.payload.lineUserId)
    : (await accounts.findByUserId(item.shopUserId)).find(a => a.status === 'active' && inScope(a)) ?? null;
  return account && account.userId === item.shopUserId && inScope(account) ? account : null;
}
export async function scopedItem(id: string, items = reviewItemRepository, accounts = lineAccountRepository) {
  if (!uuid(id)) return null;
  const item = await items.findById(id);
  if (!item) return null;
  const account = await itemAccount(item, accounts);
  return account ? { item, account } : null;
}

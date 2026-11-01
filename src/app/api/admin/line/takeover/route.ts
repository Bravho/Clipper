/**
 * POST /api/admin/line/takeover
 *
 * Enable or disable per-shop human-takeover mode for a LINE user.
 * When active, the LINE webhook silently ignores incoming messages from that shop.
 *
 * Auth: Bearer token — timing-safe compare against REVIEW_ADMIN_TOKEN env var.
 *
 * Body (JSON):
 *   {
 *     lineChannelId: string,
 *     lineUserId: string,
 *     active: boolean,
 *     hours?: number   // optional override; defaults to LINE_TAKEOVER_TIMEOUT_HOURS env var (24)
 *   }
 *
 * Returns 200 { ok: true } on success.
 * Returns 404 if the account does not exist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { lineAccountRepository } from '@/repositories';

function checkAdminToken(request: NextRequest): boolean {
  const expected = process.env.REVIEW_ADMIN_TOKEN;
  if (!expected) return false;
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  try {
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getTakeoverHours(): number {
  const val = Number(process.env.LINE_TAKEOVER_TIMEOUT_HOURS ?? '24');
  return Number.isFinite(val) && val > 0 ? val : 24;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!process.env.REVIEW_ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }
  if (!checkAdminToken(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { lineChannelId, lineUserId, active, hours } = body;
  if (typeof lineChannelId !== 'string' || typeof lineUserId !== 'string' || typeof active !== 'boolean') {
    return NextResponse.json(
      { error: 'lineChannelId, lineUserId, and active (boolean) are required.' },
      { status: 400 }
    );
  }

  const account = await lineAccountRepository.findByLineUser(lineChannelId, lineUserId);
  if (!account) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  const timeoutHours = typeof hours === 'number' && hours > 0 ? hours : getTakeoverHours();
  const expiresAt = active ? new Date(Date.now() + timeoutHours * 3600 * 1000) : null;

  await lineAccountRepository.setTakeover(account.id, active, expiresAt);
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/admin/review/[id]/decision
 *
 * Submits an approve/reject/manual_reply decision for a review item.
 *
 * Auth: Bearer token — timing-safe compare against REVIEW_ADMIN_TOKEN env var.
 * Returns 401 if token is missing or invalid, 503 if REVIEW_ADMIN_TOKEN is unset.
 *
 * Body (JSON):
 *   { version: number, decision: "approve"|"reject"|"manual_reply", replyText?: string }
 *
 * On success returns 200 with the updated ReviewItem.
 * Returns 400 on invalid input, 409 on version conflict or render_not_ready.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createReviewService } from '@/repositories';

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

const VALID_DECISIONS = new Set(['approve', 'reject', 'manual_reply']);

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
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

  const { version, decision, replyText } = body;

  if (typeof version !== 'number' || !VALID_DECISIONS.has(decision as string)) {
    return NextResponse.json(
      { error: 'version (number) and decision (approve|reject|manual_reply) are required.' },
      { status: 400 }
    );
  }

  if (decision === 'manual_reply' && typeof replyText !== 'string') {
    return NextResponse.json({ error: 'replyText is required for manual_reply.' }, { status: 400 });
  }

  try {
    const item = await createReviewService().decide({
      itemId: params.id,
      expectedVersion: version as number,
      // Token automation has no users-row identity; leave the nullable UUID FK null.
      actorUserId: undefined,
      actorVia: 'grokbot_app',
      decision: decision as 'approve' | 'reject' | 'manual_reply',
      replyText: typeof replyText === 'string' ? replyText : undefined,
    });
    return NextResponse.json({ item });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? (err as Error)?.message;
    if (code === 'version_conflict' || code === 'render_not_ready' || code === 'not_found') {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    console.error('[admin/review/decision] unexpected error:', err);
    return NextResponse.json({ error: 'Internal error.' }, { status: 500 });
  }
}

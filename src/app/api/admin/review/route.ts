/**
 * GET /api/admin/review
 *
 * Returns pending review items for the Grok Bot admin interface.
 *
 * Auth: Bearer token — timing-safe compare against REVIEW_ADMIN_TOKEN env var.
 * Returns 401 if token is missing or invalid, 503 if REVIEW_ADMIN_TOKEN is unset.
 *
 * Response: { items: ReviewItem[] }
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!process.env.REVIEW_ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }
  if (!checkAdminToken(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const items = await createReviewService().listPending();
  return NextResponse.json({ items });
}

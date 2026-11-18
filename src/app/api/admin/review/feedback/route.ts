/**
 * GET /api/admin/review/feedback?limit=50
 *
 * Recent review decisions and their reasons, for RevBot to learn from.
 * Returns no customer text, no shop or LINE identifiers, and no payload.
 *
 * Auth: Bearer token, same as the other admin routes (REVIEW_ADMIN_TOKEN).
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { pool } from '@/lib/db';

function checkAdminToken(request: NextRequest): boolean {
  const expected = process.env.REVIEW_ADMIN_TOKEN;
  if (!expected) return false;
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!process.env.REVIEW_ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }
  if (!checkAdminToken(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 50;

  const { rows } = await pool.query(
    `SELECT a.action, a.to_status, a.actor_via, a.reason_code, a.reason_text, a.created_at,
            i.type_key, i.gate_step
       FROM review_actions a
       JOIN review_items i ON i.id = a.review_item_id
      WHERE a.action IN ('approved', 'rejected', 'manual_reply', 'edited')
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return NextResponse.json({
    feedback: rows.map(r => ({
      action: r.action,
      toStatus: r.to_status,
      actorVia: r.actor_via,
      reasonCode: r.reason_code,
      reasonText: r.reason_text,
      typeKey: r.type_key,
      gateStep: r.gate_step,
      createdAt: r.created_at,
    })),
  });
}

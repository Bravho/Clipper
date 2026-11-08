import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/** Bearer check against LOCATION_BRIDGE_TOKEN (separate from the admin token). */
export function locationBridgeAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.LOCATION_BRIDGE_TOKEN;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const auth = req.headers.get('authorization') ?? '';
  const supplied = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

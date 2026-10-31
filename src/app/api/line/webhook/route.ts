/**
 * POST /api/line/webhook
 *
 * LINE Messaging API webhook endpoint.
 *
 * Security:
 * - Reads raw body and verifies X-Line-Signature = base64(HMAC-SHA256(secret, rawBody)).
 * - Returns 401 if signature is missing or invalid.
 * - Returns 200 immediately after signature check (LINE requires < 1s response).
 * - LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN from env only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyLineSignature, processLineEvent } from '@/services/line/LineWebhookService';
import { getLineChannelSecret } from '@/config/lineIntake';
import { LineClient } from '@/lib/line/LineClient';
import { lineAccountRepository } from '@/repositories/index';
import { isLineIntakeEnabled } from '@/config/reviewSystem';

const lineClient = new LineClient();

// LINE's channelId identifying this OA instance
const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID ?? 'default';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isLineIntakeEnabled()) {
    return NextResponse.json({ error: 'LINE intake is not enabled.' }, { status: 503 });
  }

  let secret: string;
  try {
    secret = getLineChannelSecret();
  } catch {
    console.error('[line/webhook] LINE_CHANNEL_SECRET not configured');
    return NextResponse.json({ error: 'Integration not configured.' }, { status: 500 });
  }

  // Read raw body for HMAC verification
  const rawBodyBytes = await request.arrayBuffer();
  const rawBody = Buffer.from(rawBodyBytes);

  const signature = request.headers.get('x-line-signature');
  if (!verifyLineSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  // Parse body
  let payload: { events?: unknown[] };
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Process events asynchronously (fire-and-forget so LINE gets 200 fast)
  const events = Array.isArray(payload.events) ? payload.events : [];
  Promise.all(
    events.map(async (event) => {
      try {
        await processLineEvent(event as Parameters<typeof processLineEvent>[0], {
          lineChannelId: LINE_CHANNEL_ID,
          lineClient,
          lineAccountRepo: lineAccountRepository,
        });
      } catch (err) {
        console.error('[line/webhook] event processing error:', err);
      }
    })
  ).catch((err) => console.error('[line/webhook] batch error:', err));

  return NextResponse.json({ ok: true });
}

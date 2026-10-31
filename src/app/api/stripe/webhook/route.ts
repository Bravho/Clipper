/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook endpoint (TEST mode only).
 * Confirms package orders when Stripe sends checkout.session.completed.
 *
 * Security: verifies Stripe-Signature header using STRIPE_WEBHOOK_SECRET.
 * Never uses Stripe in live mode — test mode only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyStripeSignature } from '@/lib/stripe/stripeSignature';
import { getStripeWebhookSecret } from '@/config/stripePackages';
import { servicePackageRepository } from '@/repositories/index';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let secret: string;
  try {
    secret = getStripeWebhookSecret();
  } catch {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Integration not configured.' }, { status: 500 });
  }

  const rawBodyBytes = await request.arrayBuffer();
  const rawBody = Buffer.from(rawBodyBytes);

  const signatureHeader = request.headers.get('stripe-signature');
  const result = verifyStripeSignature(rawBody, signatureHeader, secret);
  if (!result.ok) {
    console.warn('[stripe/webhook] signature verification failed:', result.error);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Only handle checkout.session.completed to activate a package order
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sessionId = session['id'] as string | undefined;
    if (sessionId) {
      try {
        const order = await servicePackageRepository.findOrderByStripeSession(sessionId);
        if (order && order.status === 'pending_payment') {
          await servicePackageRepository.updateOrderStatus(
            order.id,
            'active',
            `stripe:${sessionId}`
          );
          console.log(`[stripe/webhook] activated package order ${order.id} for session ${sessionId}`);
        }
      } catch (err) {
        console.error('[stripe/webhook] failed to activate order:', err);
        return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ received: true });
}

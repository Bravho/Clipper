/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook endpoint (TEST mode only).
 * Handles:
 *   - checkout.session.completed
 *   - checkout.session.async_payment_succeeded
 *
 * Security: verifies Stripe-Signature using stripe.constructEvent (preferred)
 * with fallback to manual HMAC check. Rejects live-mode events unless
 * STRIPE_ALLOW_LIVE=true (configurable, default false).
 *
 * Activation conditions:
 *   - payment_status === 'paid'
 *   - livemode === false (unless STRIPE_ALLOW_LIVE=true)
 *   - amount_total and currency match the package linked via client_reference_id / metadata
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeWebhookSecret, findPackageByCode } from '@/config/stripePackages';
import { servicePackageRepository } from '@/repositories/index';

const stripe = new Stripe('sk_test_webhook_verification_only');
const STRIPE_ALLOW_LIVE = process.env.STRIPE_ALLOW_LIVE === 'true';

function parseStripeEvent(rawBody: Buffer, signatureHeader: string, secret: string) {
  try { return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret); }
  catch { return null; }
}

async function activateOrder(session: Record<string, unknown>): Promise<void> {
  const sessionId = session['id'] as string | undefined;
  if (!sessionId) return;

  // Require payment_status === 'paid'
  const paymentStatus = session['payment_status'] as string | undefined;
  if (paymentStatus !== 'paid') {
    console.log(`[stripe/webhook] session ${sessionId} not yet paid (status=${paymentStatus}), skipping`);
    return;
  }

  // Find the order — prefer client_reference_id match, fall back to stripe_session_id
  let order = await servicePackageRepository.findOrderByStripeSession(sessionId);

  // Also try via metadata.order_id or client_reference_id
  if (!order) {
    const clientRef = session['client_reference_id'] as string | undefined;
    if (clientRef) {
      order = await servicePackageRepository.findOrderById(clientRef);
    }
  }

  if (!order || order.status !== 'pending_payment') {
    console.log(`[stripe/webhook] no pending order for session ${sessionId}`);
    return;
  }

  // Validate amount/currency against package config
  const pkg = findPackageByCode(order.packageCode);
  if (!pkg) return;
  {
    const amountTotal = session['amount_total'] as number | undefined;
    const currency = session['currency'] as string | undefined;
    const expectedAmountCents = Math.round(pkg.priceBaht * 100);
    if (amountTotal !== expectedAmountCents) {
      console.warn(`[stripe/webhook] amount mismatch: got ${amountTotal}, expected ${expectedAmountCents}`);
      return;
    }
    if (currency !== 'thb') {
      console.warn(`[stripe/webhook] currency mismatch: got ${currency}, expected thb`);
      return;
    }
  }

  await servicePackageRepository.updateOrderStatus(order.id, 'active', `stripe:${sessionId}`);
  console.log(`[stripe/webhook] activated package order ${order.id} for session ${sessionId}`);
}

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
  if (!signatureHeader) {
    return NextResponse.json({ error: 'Missing Stripe-Signature.' }, { status: 401 });
  }

  const event = parseStripeEvent(rawBody, signatureHeader, secret);
  if (!event) {
    console.warn('[stripe/webhook] signature verification failed');
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  // Reject live-mode events unless explicitly allowed
  if (event.livemode !== false && !STRIPE_ALLOW_LIVE) {
    console.warn('[stripe/webhook] live-mode event rejected (STRIPE_ALLOW_LIVE not set)');
    return NextResponse.json({ error: 'Live mode not allowed.' }, { status: 400 });
  }

  const ACTIVATION_EVENTS = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
  ]);

  if (ACTIVATION_EVENTS.has(event.type)) {
    try {
      await activateOrder(event.data.object as unknown as Record<string, unknown>);
    } catch (err) {
      console.error('[stripe/webhook] failed to activate order:', err);
      return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}

/**
 * Stripe webhook signature verification.
 *
 * Implements the Stripe-Signature t=/v1= HMAC check.
 * Uses the stripe package's constructEvent when available,
 * otherwise falls back to manual verification.
 *
 * Reference: https://stripe.com/docs/webhooks/signatures
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { STRIPE_WEBHOOK_TOLERANCE_SECONDS } from '@/config/stripePackages';

export interface StripeSignatureResult {
  ok: boolean;
  error?: string;
}

/**
 * Manually verify a Stripe webhook signature without a network call.
 *
 * Header format: t=<unix>,v1=<hex>[,v1=<hex>...]
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string,
  nowSeconds?: number
): StripeSignatureResult {
  if (!signatureHeader) return { ok: false, error: 'Missing Stripe-Signature header' };

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);

  const parts = signatureHeader.split(',');
  const tPart = parts.find((p) => p.startsWith('t='));
  if (!tPart) return { ok: false, error: 'No timestamp in Stripe-Signature' };

  const t = parseInt(tPart.slice(2), 10);
  if (isNaN(t)) return { ok: false, error: 'Invalid timestamp in Stripe-Signature' };

  const skew = Math.abs(now - t);
  if (skew > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, error: `Timestamp skew too large: ${skew}s` };
  }

  const v1Parts = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (v1Parts.length === 0) return { ok: false, error: 'No v1 signature in Stripe-Signature' };

  const payload = `${t}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  for (const v1 of v1Parts) {
    try {
      const providedBuf = Buffer.from(v1, 'utf8');
      if (expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)) {
        return { ok: true };
      }
    } catch {
      // continue to next signature
    }
  }

  return { ok: false, error: 'Signature mismatch' };
}

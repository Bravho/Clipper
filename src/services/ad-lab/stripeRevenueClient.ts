/**
 * Read-only Stripe revenue for Chinese_TTT Analyze.
 * Lists succeeded charges / PaymentIntents filtered by metadata.
 * Never creates PaymentIntents, Checkout sessions, or payouts.
 */

import Stripe from "stripe";
import {
  AD_LAB_STRIPE_OUTCOMES,
  stripeOutcomesConfigured,
} from "@/config/adLabIntegrations";

export interface StripeRevenueSnapshot {
  stub: boolean;
  amountBaht: number;
  chargeCount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  productFilter: string;
  message: string;
  raw?: unknown;
}

export async function fetchStripeRevenue(input: {
  periodStart: Date;
  periodEnd: Date;
}): Promise<StripeRevenueSnapshot> {
  const periodStart = input.periodStart.toISOString();
  const periodEnd = input.periodEnd.toISOString();
  const productFilter = AD_LAB_STRIPE_OUTCOMES.metadataKey + "=" + AD_LAB_STRIPE_OUTCOMES.metadataValue;

  if (!stripeOutcomesConfigured()) {
    return {
      stub: true,
      amountBaht: 0,
      chargeCount: 0,
      currency: "thb",
      periodStart,
      periodEnd,
      productFilter,
      message:
        "Stripe secret missing — set AD_LAB_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY). Stub revenue = 0. Read-only; no charges created.",
    };
  }

  const stripe = new Stripe(AD_LAB_STRIPE_OUTCOMES.secretKey);
  const gte = Math.floor(input.periodStart.getTime() / 1000);
  const lte = Math.floor(input.periodEnd.getTime() / 1000);

  const intents = await stripe.paymentIntents.list({
    created: { gte, lte },
    limit: 100,
  });

  let amountBaht = 0;
  let chargeCount = 0;
  const matched: Array<{ id: string; amount: number }> = [];

  for (const pi of intents.data) {
    if (pi.status !== "succeeded") continue;
    const meta = pi.metadata ?? {};
    const key = AD_LAB_STRIPE_OUTCOMES.metadataKey;
    const want = AD_LAB_STRIPE_OUTCOMES.metadataValue;
    if (want !== "*" && (meta[key] ?? "") !== want) continue;
    const baht = (pi.amount_received || pi.amount || 0) / 100;
    amountBaht += baht;
    chargeCount += 1;
    matched.push({ id: pi.id, amount: baht });
  }

  return {
    stub: false,
    amountBaht,
    chargeCount,
    currency: "thb",
    periodStart,
    periodEnd,
    productFilter,
    message: "Loaded " + chargeCount + " succeeded Stripe payment(s) for " + productFilter + ".",
    raw: { matchedCount: matched.length, sample: matched.slice(0, 5) },
  };
}

export { stripeOutcomesConfigured };

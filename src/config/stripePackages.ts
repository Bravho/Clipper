/**
 * Stripe package configuration (TEST mode).
 *
 * Payment link URLs come from env/config as placeholders.
 * No live Stripe calls are made here.
 */

export interface PackageConfig {
  code: string;
  nameTh: string;
  priceBaht: number;
  clipsIncluded: number;
  revisionsPerClip: number;
  maxDurationSeconds: number;
  /** Stripe Payment Link URL (TEST mode, from env or placeholder). */
  paymentLinkUrl: string;
}

/** Packages as defined by owner decision 4. */
export const PACKAGES: readonly PackageConfig[] = [
  {
    code: 'trial',
    nameTh: 'Trial — 2 คลิป',
    priceBaht: 299,
    clipsIncluded: 2,
    revisionsPerClip: 2,
    maxDurationSeconds: 90,
    paymentLinkUrl: process.env.STRIPE_PAYMENT_LINK_TRIAL ?? 'https://buy.stripe.com/test/trial_placeholder',
  },
  {
    code: 'starter',
    nameTh: 'Starter — 8 คลิป',
    priceBaht: 1490,
    clipsIncluded: 8,
    revisionsPerClip: 2,
    maxDurationSeconds: 90,
    paymentLinkUrl: process.env.STRIPE_PAYMENT_LINK_STARTER ?? 'https://buy.stripe.com/test/starter_placeholder',
  },
  {
    code: 'growth',
    nameTh: 'Growth — 12 คลิป',
    priceBaht: 2690,
    clipsIncluded: 12,
    revisionsPerClip: 2,
    maxDurationSeconds: 90,
    paymentLinkUrl: process.env.STRIPE_PAYMENT_LINK_GROWTH ?? 'https://buy.stripe.com/test/growth_placeholder',
  },
  {
    code: 'pro',
    nameTh: 'Pro — 16 คลิป',
    priceBaht: 4290,
    clipsIncluded: 16,
    revisionsPerClip: 2,
    maxDurationSeconds: 90,
    paymentLinkUrl: process.env.STRIPE_PAYMENT_LINK_PRO ?? 'https://buy.stripe.com/test/pro_placeholder',
  },
] as const;

export function findPackageByCode(code: string): PackageConfig | undefined {
  return PACKAGES.find((p) => p.code === code);
}

/** Stripe webhook secret from env (required). */
export function getStripeWebhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  return s;
}

/** Stripe secret key (TEST mode, never used for live charges). */
export function getStripeSecretKey(): string {
  const s = process.env.STRIPE_SECRET_KEY;
  if (!s) throw new Error('STRIPE_SECRET_KEY is not configured');
  return s;
}

/** Tolerance window for Stripe webhook timestamp verification (seconds). */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

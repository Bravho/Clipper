/**
 * Payment gateway configuration.
 *
 * Provider: Stripe. Method: PromptPay QR only.
 *
 * All values are read from environment variables (see .env.example → "Payments").
 *
 * Stripe creates and confirms a THB PaymentIntent and returns its PromptPay QR.
 * Settlement is driven by a signed webhook with polling as a recovery backstop.
 */
export const PAYMENTS_CONFIG = {
  provider: "stripe" as const,

  stripe: {
    secretKey: (process.env.STRIPE_SECRET_KEY ?? "").trim(),
    webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim(),
  },

  /** Minutes a generated PromptPay QR / payment intent stays payable. */
  intentTtlMinutes: Number(process.env.PAYMENT_INTENT_TTL_MINUTES ?? "30"),

  /**
   * Poll-side settlement backstop: the status endpoint re-verifies a still-Pending
   * intent against the gateway (so a payment settles even if the webhook is never
   * delivered), but at most once per this many milliseconds per intent to avoid
   * hammering the gateway. The client polls every ~3s; 10s throttles that to a
   * gateway hit roughly every 3rd–4th poll.
   */
  pollBackstopThrottleMs: Number(process.env.PAYMENT_POLL_BACKSTOP_THROTTLE_MS ?? "10000"),
} as const;

export function requireStripeSecretKey(): string {
  const key = PAYMENTS_CONFIG.stripe.secretKey;
  if (!key) throw new Error("Stripe keys are not set. Add STRIPE_SECRET_KEY to .env.local.");

  // Live-mode enforcement: test-mode PromptPay QRs are simulations that real
  // bank apps cannot scan, so a test key must never reach production. In dev a
  // test key still works (with the UI's test-mode banner) but is warned about.
  if (key.startsWith("sk_test")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "STRIPE_SECRET_KEY is a TEST key (sk_test…) — production requires a live key (sk_live…)."
      );
    }
    console.warn(
      "[payments] STRIPE_SECRET_KEY is a test key — PromptPay QRs will be simulations, not scannable by bank apps."
    );
  }
  return key;
}

export function requireStripeWebhookSecret(): string {
  const secret = PAYMENTS_CONFIG.stripe.webhookSecret;
  if (!secret) {
    throw new Error("Stripe keys are not set. Add STRIPE_WEBHOOK_SECRET to .env.local.");
  }
  return secret;
}

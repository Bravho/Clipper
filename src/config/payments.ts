/**
 * Payment gateway configuration.
 *
 * Provider: **GB Prime Pay** (Xendit Tech Co., Ltd.) — Thai-licensed PSP.
 * Method at launch: **PromptPay QR only**. Credit-card / recurring billing is
 * intentionally deferred, so no card config is read here yet.
 *
 * All values are read from environment variables (see .env.example → "Payments").
 *
 * GB Prime Pay QR flow:
 *   1. POST {baseUrl}/v3/qrcode with { token/publicKey, amount, referenceNo,
 *      backgroundUrl, detail } → returns a PromptPay QR (PNG/base64) + gbpReferenceNo.
 *   2. Customer scans & pays in their banking app.
 *   3. GB Prime Pay POSTs the result to `backgroundUrl` (our webhook).
 *   4. We DO NOT trust the webhook body blindly — we re-verify server-to-server
 *      via the check-status endpoint before crediting the wallet.
 */
export const PAYMENTS_CONFIG = {
  provider: "gbprimepay" as const,

  gbPrimePay: {
    /** API base URL. Override for sandbox vs production. */
    baseUrl: (process.env.GBPRIMEPAY_BASE_URL ?? "https://api.gbprimepay.com").trim(),
    /** Public key — used to create QR charges. */
    publicKey: (process.env.GBPRIMEPAY_PUBLIC_KEY ?? "").trim(),
    /** Secret key — used for server-to-server status verification. */
    secretKey: (process.env.GBPRIMEPAY_SECRET_KEY ?? "").trim(),
    /** Publicly reachable webhook URL GB Prime Pay calls after payment. */
    webhookUrl: (process.env.GBPRIMEPAY_WEBHOOK_URL ?? "").trim(),
    /** GB Prime Pay success result code. */
    successResultCode: "00",
  },

  /** Minutes a generated PromptPay QR / payment intent stays payable. */
  intentTtlMinutes: Number(process.env.PAYMENT_INTENT_TTL_MINUTES ?? "30"),
} as const;

export function requireGbPrimePayKeys(): { publicKey: string; secretKey: string } {
  const { publicKey, secretKey } = PAYMENTS_CONFIG.gbPrimePay;
  if (!publicKey || !secretKey) {
    throw new Error(
      "GB Prime Pay keys are not set. Add GBPRIMEPAY_PUBLIC_KEY and " +
        "GBPRIMEPAY_SECRET_KEY to .env.local and restart the dev server."
    );
  }
  return { publicKey, secretKey };
}

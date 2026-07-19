/**
 * Lifecycle of a payment (top-up) intent.
 *
 * Pending  → QR issued, awaiting customer payment
 * Paid     → gateway confirmed payment AND wallet credited (terminal, success)
 * Expired  → QR TTL elapsed with no payment (terminal)
 * Failed   → gateway reported a non-success result (terminal)
 */
export enum PaymentStatus {
  Pending = "pending",
  Paid = "paid",
  Expired = "expired",
  Failed = "failed",
}

/** Payment gateway providers. GB Prime Pay remains for historical records. */
export enum PaymentGateway {
  GbPrimePay = "gbprimepay",
  Stripe = "stripe",
}

/** Payment method used for the Stripe top-up. */
export enum PaymentMethod {
  PromptPayQr = "promptpay_qr",
  Card = "card",
}

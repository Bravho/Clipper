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

/** Payment gateway providers. Only PromptPay via GB Prime Pay at launch. */
export enum PaymentGateway {
  GbPrimePay = "gbprimepay",
}

/** Payment method. Card is deferred; PromptPay only for now. */
export enum PaymentMethod {
  PromptPayQr = "promptpay_qr",
}

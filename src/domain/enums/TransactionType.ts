/**
 * Types of credit wallet transactions.
 *
 * - SignupBonus:   RETIRED. New accounts get NO free credits — the free tier is
 *                  a quota (3 videos per rolling 30 days), not a credit grant,
 *                  so CREDITS_CONFIG.SIGNUP_BONUS_CREDITS is 0 and
 *                  CreditService.grantSignupBonus short-circuits without
 *                  touching the balance or writing a ledger row. The member is
 *                  kept because historical rows of this type exist and the
 *                  admin ledger still has to render them.
 * - RequestCharge: Credits deducted when a clip request is submitted (future)
 * - AdminCredit:   Manual credit grant by admin (future)
 * - AdminDebit:    Manual credit removal by admin (future)
 */
export enum TransactionType {
  SignupBonus = "signup_bonus",
  RequestCharge = "request_charge",
  RequestRefund = "request_refund",
  AdminCredit = "admin_credit",
  AdminDebit = "admin_debit",
  DiscountApplied = "discount_applied",
  /** Credits added by a confirmed PromptPay top-up via Stripe. */
  TopUp = "top_up",
  /** Credits spent on an RClipper Management package (bundle or access pass). */
  ManagementPurchase = "management_purchase",
  /** Credits returned when a Management purchase is refunded. */
  ManagementRefund = "management_refund",
}

/**
 * Types of credit wallet transactions.
 *
 * - SignupBonus:    30 free credits granted on new account creation
 * - RequestCharge: Credits deducted when a clip request is submitted (future)
 * - AdminCredit:   Manual credit grant by admin (future)
 * - AdminDebit:    Manual credit removal by admin (future)
 */
export enum TransactionType {
  SignupBonus = "signup_bonus",
  RequestCharge = "request_charge",
  AdminCredit = "admin_credit",
  AdminDebit = "admin_debit",
}

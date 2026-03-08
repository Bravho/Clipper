/**
 * Shared application types.
 * Re-exports domain types for convenience.
 */

export type { User, CreateUserInput } from "@/domain/models/User";
export type { AuthIdentity, CreateAuthIdentityInput } from "@/domain/models/AuthIdentity";
export type { CreditWallet } from "@/domain/models/CreditWallet";
export type { CreditTransaction } from "@/domain/models/CreditTransaction";
export type { TermsAcceptance } from "@/domain/models/TermsAcceptance";
export type { PolicyVersion } from "@/domain/models/PolicyVersion";

export { Role } from "@/domain/enums/Role";
export { AuthProvider } from "@/domain/enums/AuthProvider";
export { TransactionType } from "@/domain/enums/TransactionType";
export { PolicyType } from "@/domain/enums/PolicyType";

/** Standard API response shape */
export interface ApiResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

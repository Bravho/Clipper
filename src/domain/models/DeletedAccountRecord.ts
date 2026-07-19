import { AuthProvider } from "@/domain/enums/AuthProvider";

/**
 * Fraud-prevention record retained after account deletion.
 *
 * Deliberately NOT linked to the deleted user row: it stores only one-way
 * SHA-256 hashes of the identifiers (email, OAuth provider account id) plus
 * the entitlement flags needed to stop delete-and-recreate free-trial reuse.
 *
 * Retention basis: fraud prevention — permitted by the Google Play User Data
 * policy and defensible under App Store guideline 5.1.1(v); must be disclosed
 * in the privacy policy.
 */
export interface DeletedAccountRecord {
  id: string;
  emailHash: string;                 // sha256(lower(trim(email))), hex
  provider: AuthProvider;
  providerAccountHash: string | null; // sha256(provider account id), hex; null for credentials
  trialConsumed: boolean;
  bonusGranted: boolean;
  deletedAt: Date;
}

export type CreateDeletedAccountRecordInput = Omit<
  DeletedAccountRecord,
  "id" | "deletedAt"
>;

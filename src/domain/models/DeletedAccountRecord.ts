import { AuthProvider } from "@/domain/enums/AuthProvider";

/**
 * Fraud-prevention record retained after account deletion.
 *
 * Deliberately NOT linked to the deleted user row: it stores only one-way
 * SHA-256 hashes of the identifiers (email, OAuth provider account id) plus
 * the consumed-entitlement counters needed to stop delete-and-recreate reuse of
 * the free trial ladder.
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
  /**
   * How much of the trial allowance this identity had consumed when the account
   * was deleted, capped at `TRIAL_CONFIG.FREE_REQUESTS_TOTAL`. A re-registration
   * resumes from this number instead of getting the whole ladder again.
   */
  priorTrialRequestsUsed: number;
  bonusGranted: boolean;
  deletedAt: Date;
}

export type CreateDeletedAccountRecordInput = Omit<
  DeletedAccountRecord,
  "id" | "deletedAt"
>;

import { PolicyType } from "@/domain/enums/PolicyType";

/**
 * Legal policy acceptance record.
 *
 * Created once per (userId, policyType) at signup.
 * When policy versions change, a new record is created alongside
 * the old one — preserving the full audit history.
 *
 * TODO: PostgreSQL — map to `terms_acceptances` table.
 *       Add ipAddress/userAgent columns for legal compliance.
 */
export interface TermsAcceptance {
  id: string;
  userId: string;
  policyType: PolicyType;
  /** Version of the policy accepted, e.g. "1.0.0" */
  policyVersion: string;
  acceptedAt: Date;
  /** Future: capture for legal compliance */
  ipAddress: string | null;
  userAgent: string | null;
}

export type CreateTermsAcceptanceInput = Omit<
  TermsAcceptance,
  "id" | "acceptedAt"
>;

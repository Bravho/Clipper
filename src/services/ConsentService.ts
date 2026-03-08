import { PolicyType } from "@/domain/enums/PolicyType";
import { TermsAcceptance } from "@/domain/models/TermsAcceptance";
import { CURRENT_POLICY_VERSIONS, ALL_POLICY_TYPES } from "@/config/policyVersions";
import { termsAcceptanceRepository } from "@/repositories";

export interface ConsentInput {
  policyType: PolicyType;
  accepted: boolean;
}

/**
 * ConsentService — manages legal policy acceptance records.
 *
 * Business rules:
 * - All four policies must be accepted at signup.
 * - Acceptance records are immutable — never updated, only appended.
 * - Each record captures the policy version at time of acceptance.
 *
 * TODO: When policy versioning is active in production, add a
 *       checkRequiresReAcceptance(userId) method that compares stored
 *       versions to CURRENT_POLICY_VERSIONS. Drive this check at login.
 */
export class ConsentService {
  /**
   * Record acceptance of all policies for a new user.
   * Only creates records for policies where accepted === true.
   */
  async recordConsents(
    userId: string,
    consents: ConsentInput[],
    meta?: { ipAddress?: string; userAgent?: string }
  ): Promise<TermsAcceptance[]> {
    const accepted = consents.filter((c) => c.accepted);
    const records: TermsAcceptance[] = [];

    for (const consent of accepted) {
      const version = CURRENT_POLICY_VERSIONS[consent.policyType].version;
      const record = await termsAcceptanceRepository.create({
        userId,
        policyType: consent.policyType,
        policyVersion: version,
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
      });
      records.push(record);
    }

    return records;
  }

  /** Retrieve all acceptance records for a user. */
  async getUserConsents(userId: string): Promise<TermsAcceptance[]> {
    return termsAcceptanceRepository.findByUserId(userId);
  }

  /**
   * Validate that all required policies have been accepted.
   * Used in signup validation before account creation.
   */
  async hasAcceptedAllCurrentPolicies(userId: string): Promise<boolean> {
    for (const policyType of ALL_POLICY_TYPES) {
      const acceptance = await termsAcceptanceRepository.findLatestByUserIdAndType(
        userId,
        policyType
      );
      if (!acceptance) return false;
      // Check that the accepted version matches the current version
      if (acceptance.policyVersion !== CURRENT_POLICY_VERSIONS[policyType].version) {
        return false;
      }
    }
    return true;
  }

  /**
   * Validate consent inputs before account creation.
   * Returns list of missing policy types if any.
   */
  validateAllConsentsProvided(consents: ConsentInput[]): PolicyType[] {
    const missing: PolicyType[] = [];
    for (const policyType of ALL_POLICY_TYPES) {
      const found = consents.find(
        (c) => c.policyType === policyType && c.accepted
      );
      if (!found) missing.push(policyType);
    }
    return missing;
  }
}

export const consentService = new ConsentService();

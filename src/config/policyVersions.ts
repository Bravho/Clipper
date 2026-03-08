import { PolicyType } from "@/domain/enums/PolicyType";
import { PolicyVersion } from "@/domain/models/PolicyVersion";

/**
 * Current versions of all legal policies.
 *
 * When any policy is updated:
 * 1. Increment the version string here.
 * 2. Update the policy page content.
 * 3. Trigger re-acceptance flow for existing users (future).
 *
 * TODO: Move this into a database table for dynamic policy management.
 */
export const CURRENT_POLICY_VERSIONS: Record<PolicyType, PolicyVersion> = {
  [PolicyType.TermsOfService]: {
    type: PolicyType.TermsOfService,
    version: "1.0.0",
    effectiveDate: new Date("2024-01-01"),
    description: "Clipper Platform Terms of Service",
  },
  [PolicyType.OwnershipRights]: {
    type: PolicyType.OwnershipRights,
    version: "1.0.0",
    effectiveDate: new Date("2024-01-01"),
    description: "Content Ownership and Usage Rights Policy",
  },
  [PolicyType.PrivacyPolicy]: {
    type: PolicyType.PrivacyPolicy,
    version: "1.0.0",
    effectiveDate: new Date("2024-01-01"),
    description: "Clipper Platform Privacy Policy",
  },
  [PolicyType.StorageRetention]: {
    type: PolicyType.StorageRetention,
    version: "1.0.0",
    effectiveDate: new Date("2024-01-01"),
    description: "Storage and File Retention Policy",
  },
};

export const ALL_POLICY_TYPES = Object.values(PolicyType);

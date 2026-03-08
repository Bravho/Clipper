import { PolicyType } from "@/domain/enums/PolicyType";

/**
 * Policy version registry entry.
 *
 * Tracks the canonical "current" version of each legal policy.
 * When a policy is updated, bump the version here. The consent
 * UI will present the new version for re-acceptance.
 *
 * TODO: PostgreSQL — map to `policy_versions` table.
 *       Drive re-acceptance flow from this table at login time.
 */
export interface PolicyVersion {
  type: PolicyType;
  /** Semantic version string, e.g. "1.0.0" */
  version: string;
  effectiveDate: Date;
  description: string;
}

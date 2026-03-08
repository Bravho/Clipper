/**
 * Types of legal policies that users must accept at signup.
 *
 * Each policy type has its own acceptance record, allowing
 * independent versioning and re-acceptance when policies change.
 */
export enum PolicyType {
  TermsOfService = "terms_of_service",
  OwnershipRights = "ownership_rights",
  PrivacyPolicy = "privacy_policy",
  StorageRetention = "storage_retention",
}

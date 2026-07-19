import { createHash } from "crypto";

/**
 * One-way hashes used by the deleted-account registry (fraud prevention).
 * Hex-encoded SHA-256, matching the format stored in deleted_account_registry.
 */

/** Hash an email address (normalized: trimmed + lowercased). */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** Hash an OAuth provider account id (Google/Apple `sub` claim). */
export function hashProviderAccountId(providerAccountId: string): string {
  return createHash("sha256").update(providerAccountId).digest("hex");
}

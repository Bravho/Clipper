/**
 * Repository registry — single source of repository instances.
 *
 * Services import repositories from here only.
 *
 * Phase 2A repositories: backed by PostgreSQL.
 * Phase 2B repositories: backed by in-memory mock (PostgreSQL not yet connected).
 *
 * To swap Phase 2B to PostgreSQL:
 *   1. Implement Postgres* classes under repositories/postgres/.
 *   2. Import them below and replace the Mock* instances.
 *   3. Delete the corresponding Mock* files.
 *
 * To revert Phase 2A to mocks for isolated unit tests, swap the imports
 * back to the Mock* implementations and pass a fresh Map() to each constructor.
 */

// ── Phase 2A — PostgreSQL ────────────────────────────────────────────────────
import { PostgresUserRepository } from "./postgres/PostgresUserRepository";
import { PostgresAuthIdentityRepository } from "./postgres/PostgresAuthIdentityRepository";
import { PostgresCreditWalletRepository } from "./postgres/PostgresCreditWalletRepository";
import { PostgresCreditTransactionRepository } from "./postgres/PostgresCreditTransactionRepository";
import { PostgresTermsAcceptanceRepository } from "./postgres/PostgresTermsAcceptanceRepository";
import { PostgresEmailVerificationTokenRepository } from "./postgres/PostgresEmailVerificationTokenRepository";

export const userRepository = new PostgresUserRepository();
export const authIdentityRepository = new PostgresAuthIdentityRepository();
export const creditWalletRepository = new PostgresCreditWalletRepository();
export const creditTransactionRepository = new PostgresCreditTransactionRepository();
export const termsAcceptanceRepository = new PostgresTermsAcceptanceRepository();
export const emailVerificationTokenRepository = new PostgresEmailVerificationTokenRepository();

// ── Phase 2B — Mock (TODO: replace with Postgres implementations) ────────────
import { MockClipRequestRepository } from "./mock/MockClipRequestRepository";
import { MockRequestStatusHistoryRepository } from "./mock/MockRequestStatusHistoryRepository";
import { MockUploadedAssetRepository } from "./mock/MockUploadedAssetRepository";
import { MockPublishingLinkRepository } from "./mock/MockPublishingLinkRepository";

// TODO: PostgreSQL Phase 2B — replace each Mock* below with Postgres* equivalent.
//   PostgresClipRequestRepository
//   PostgresRequestStatusHistoryRepository
//   PostgresUploadedAssetRepository
//   PostgresPublishingLinkRepository
export const clipRequestRepository = new MockClipRequestRepository();
export const requestStatusHistoryRepository = new MockRequestStatusHistoryRepository();
export const uploadedAssetRepository = new MockUploadedAssetRepository();
export const publishingLinkRepository = new MockPublishingLinkRepository();

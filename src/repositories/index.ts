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

// ── New Repositories — PostgreSQL ────────────────────────────────────────────
import { PostgresBusinessProfileRepository } from "./postgres/PostgresBusinessProfileRepository";
import { PostgresCreditPurchaseLogRepository } from "./postgres/PostgresCreditPurchaseLogRepository";

export const businessProfileRepository = new PostgresBusinessProfileRepository();
export const creditPurchaseLogRepository = new PostgresCreditPurchaseLogRepository();

// ── Phase 2B — PostgreSQL ────────────────────────────────────────────────────
// Clip requests, their status history, and uploaded assets now persist to
// PostgreSQL so they survive server restarts and page refreshes. Requires
// migration 006 (id defaults) to have been applied — the Phase 2B tables
// declared `id TEXT PRIMARY KEY` with no default, which 006 backfills.
import { PostgresClipRequestRepository } from "./postgres/PostgresClipRequestRepository";
import { PostgresRequestStatusHistoryRepository } from "./postgres/PostgresRequestStatusHistoryRepository";
import { PostgresUploadedAssetRepository } from "./postgres/PostgresUploadedAssetRepository";
import { MockPublishingLinkRepository } from "./mock/MockPublishingLinkRepository";

export const clipRequestRepository = new PostgresClipRequestRepository();
export const requestStatusHistoryRepository = new PostgresRequestStatusHistoryRepository();
export const uploadedAssetRepository = new PostgresUploadedAssetRepository();
export const publishingLinkRepository = new MockPublishingLinkRepository(); // TODO: PostgresPublishingLinkRepository (no Postgres impl yet)

// ── Phase 2C — Mock (TODO: replace with Postgres implementations) ────────────
import { MockInternalNoteRepository } from "./mock/MockInternalNoteRepository";

// TODO: PostgreSQL Phase 2C — replace each Mock* below with Postgres* equivalent.
//   PostgresInternalNoteRepository
export const internalNoteRepository = new MockInternalNoteRepository();

// ── Phase 2D — Mock (TODO: replace with Postgres implementations) ────────────
import { MockProductionReviewRepository } from "./mock/MockProductionReviewRepository";

// TODO: PostgreSQL Phase 2D — replace each Mock* below with Postgres* equivalent.
//   PostgresProductionReviewRepository
export const productionReviewRepository = new MockProductionReviewRepository();

// ── Editor Profiles — Mock (TODO: replace with Postgres implementation) ──────
import { MockEditorProfileRepository } from "./mock/MockEditorProfileRepository";

export const editorProfileRepository = new MockEditorProfileRepository();

// ── AI Video Pipeline — PostgreSQL ───────────────────────────────────────────
// Now that clip_requests is on PostgreSQL above, the
// `video_generation_jobs.request_id -> clip_requests.id` FK is satisfiable, so
// the pipeline job record persists to PostgreSQL too. Migration 006 also
// re-asserts the 003-005 pipeline columns (tts_task_id, subtitle_languages,
// etc.) with IF NOT EXISTS so the job insert is safe.
import { PostgresVideoGenerationJobRepository } from "./postgres/PostgresVideoGenerationJobRepository";
import { MockVideoPublishRecordRepository } from "./mock/MockVideoPublishRecordRepository";

export const videoGenerationJobRepository = new PostgresVideoGenerationJobRepository();
export const videoPublishRecordRepository = new MockVideoPublishRecordRepository(); // TODO: PostgresVideoPublishRecordRepository (no Postgres impl / table yet)


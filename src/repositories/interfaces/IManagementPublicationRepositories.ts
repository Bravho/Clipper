/**
 * Repository contracts for RClipper Management publishing.
 *
 * Kept separate from `IManagementRepositories.ts` (products, purchases, passes,
 * content) because these two aggregates — publications and the async job queue —
 * belong to the PUBLISH path rather than the collect-and-pay path, and are used
 * together by `ManagementPublicationService` and the (future) job runner.
 *
 * As everywhere else, services depend on these interfaces and receive instances
 * from `src/repositories/index.ts`.
 */

import type {
  ManagementPublication,
  ManagementPublicationTarget,
  CreatePublicationInput,
  UpdatePublicationTargetFields,
  PublicationWithTargets,
} from "@/domain/models/ManagementPublication";
import type {
  ManagementJob,
  EnqueueManagementJobInput,
} from "@/domain/models/ManagementJob";
import type {
  ManagementPublicationStatus,
} from "@/domain/enums/ManagementStatus";

export interface IManagementPublicationRepository {
  /**
   * Insert a publication and one target row per destination in ONE transaction.
   *
   * Targets are written BEFORE the provider is ever called, so a crash between
   * "we took responsibility for this post" and "the provider acknowledged it"
   * leaves an auditable, retryable record rather than a silent gap.
   */
  createWithTargets(input: CreatePublicationInput): Promise<PublicationWithTargets>;

  findById(id: string): Promise<ManagementPublication | null>;
  findByUserId(userId: string): Promise<ManagementPublication[]>;
  findByContentId(managementContentId: string): Promise<ManagementPublication[]>;
  findWithTargets(id: string): Promise<PublicationWithTargets | null>;
  findTargets(publicationId: string): Promise<ManagementPublicationTarget[]>;

  /** Record the provider's parent post id once the provider has accepted it. */
  setProviderPostId(id: string, providerPostId: string): Promise<void>;

  /** Set the rolled-up status. Derived from targets, never chosen freely. */
  updateStatus(
    id: string,
    status: ManagementPublicationStatus
  ): Promise<ManagementPublication>;

  /** Update one destination as its provider result arrives or is retried. */
  updateTarget(
    targetId: string,
    fields: UpdatePublicationTargetFields
  ): Promise<ManagementPublicationTarget>;

  /**
   * Stamp the upload-token bundle that paid for a target. Set once, immediately
   * after the token is consumed, so publishing history records which allowance
   * funded each destination. A no-op link cannot over-write an existing one.
   */
  setTargetUploadBundle(targetId: string, uploadBundleId: string): Promise<void>;
}

export interface IManagementJobRepository {
  /**
   * Enqueue work, or return the existing row when `dedupeKey` is already
   * present. Returning rather than throwing is what makes "enqueue on every
   * webhook delivery" safe.
   */
  enqueue(
    input: EnqueueManagementJobInput
  ): Promise<{ job: ManagementJob; created: boolean }>;

  findById(id: string): Promise<ManagementJob | null>;
  findByDedupeKey(dedupeKey: string): Promise<ManagementJob | null>;

  /**
   * Atomically claim the next runnable job for `workerId`: a `queued` row whose
   * `run_after` has passed, OR a `claimed` row whose heartbeat has gone stale
   * (its worker died). Uses `FOR UPDATE SKIP LOCKED` so parallel workers never
   * claim the same row. Null when nothing is runnable.
   */
  claimNext(
    workerId: string,
    now: Date,
    staleClaimMs: number
  ): Promise<ManagementJob | null>;

  /** Keep a long-running claim alive so it is not reclaimed as stale. */
  heartbeat(id: string, workerId: string, now: Date): Promise<void>;

  /** Mark a claimed job done. */
  complete(id: string): Promise<void>;

  /**
   * Record a failed attempt. A retryable failure re-queues the job with
   * `runAfter = now + backoffMs` until `maxAttempts` is reached; a permanent
   * failure (or the final attempt) moves it to `failed`.
   */
  fail(
    id: string,
    error: string,
    opts: { retryable: boolean; backoffMs: number; now: Date }
  ): Promise<ManagementJob>;
}

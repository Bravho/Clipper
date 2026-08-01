/**
 * Repository contracts for RClipper Management.
 *
 * Grouped in one file because these five aggregates are always used together by
 * the management services and share a single migration; splitting them would
 * add import noise without creating a seam anyone would use independently. Each
 * interface is still a separate, swappable contract.
 *
 * Services depend on these interfaces and receive instances from
 * `src/repositories/index.ts` — the only place implementations are constructed.
 */

import type { ManagementProduct } from "@/domain/models/ManagementProduct";
import type {
  ManagementAccessPass,
  ManagementPublishEntitlement,
} from "@/domain/models/ManagementEntitlement";
import type { ManagementUploadBundle } from "@/domain/models/ManagementUploadBundle";
import type {
  ManagementPurchase,
  CreateManagementPurchaseInput,
} from "@/domain/models/ManagementPurchase";
import { ManagementPurchaseStatus } from "@/domain/models/ManagementPurchase";
import type {
  ManagementContentItem,
  ManagementContentAsset,
  ManagementChannelSuggestion,
} from "@/domain/models/ManagementContent";
import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";
import type {
  ManagementAccessPassStatus,
  ManagementContentStatus,
  ManagementPublishEntitlementStatus,
  ManagementUploadBundleStatus,
} from "@/domain/enums/ManagementStatus";

export interface IManagementProductRepository {
  findByCode(code: ManagementProductCode): Promise<ManagementProduct | null>;
  listActive(): Promise<ManagementProduct[]>;
}

export interface IManagementPurchaseRepository {
  /**
   * Insert a purchase, or return the existing row when `idempotencyKey` has
   * already been used. Returning the existing row rather than throwing is what
   * makes a double-clicked checkout harmless.
   */
  createOrGetByIdempotencyKey(
    input: CreateManagementPurchaseInput
  ): Promise<{ purchase: ManagementPurchase; created: boolean }>;
  findById(id: string): Promise<ManagementPurchase | null>;
  findByUserId(userId: string): Promise<ManagementPurchase[]>;
  updateStatus(
    id: string,
    status: ManagementPurchaseStatus,
    fields?: {
      creditTransactionId?: string | null;
      paidAt?: Date | null;
      failureReason?: string | null;
      refundedAt?: Date | null;
      refundCreditTransactionId?: string | null;
    }
  ): Promise<ManagementPurchase>;
}

export interface IManagementAccessPassRepository {
  create(input: {
    userId: string;
    managementProductId: string;
    productCode: ManagementProductCode;
    purchaseId: string;
    creditTransactionId: string | null;
    startsAt: Date;
    expiresAt: Date;
  }): Promise<ManagementAccessPass>;
  findById(id: string): Promise<ManagementAccessPass | null>;
  findByPurchaseId(purchaseId: string): Promise<ManagementAccessPass | null>;
  findByUserId(userId: string): Promise<ManagementAccessPass[]>;
  /**
   * The user's effective access window: the latest expiry across passes that
   * are active and not revoked/refunded. Null when the user has never had a
   * pass. Used both to answer "may they publish now?" and to compute where a
   * newly purchased pass should start so remaining paid time is preserved.
   */
  findEffectiveExpiry(
    userId: string
  ): Promise<{ passId: string; startsAt: Date; expiresAt: Date } | null>;
  updateStatus(
    id: string,
    status: ManagementAccessPassStatus,
    fields?: { revokedAt?: Date | null; revokedReason?: string | null }
  ): Promise<ManagementAccessPass>;
  /**
   * Flip elapsed `active` passes to `expired`. Housekeeping only — entitlement
   * checks compare timestamps directly, so access is correct even if this has
   * never run.
   */
  markElapsedExpired(now: Date): Promise<number>;
}

/**
 * Permanent single-video publish unlocks.
 *
 * Note the absence of any "consume" operation: the unlock is not used up by
 * publishing, so there is nothing to spend.
 */
export interface IManagementPublishEntitlementRepository {
  create(input: {
    userId: string;
    managementContentId: string;
    managementProductId: string;
    purchaseId: string;
    creditTransactionId: string | null;
  }): Promise<ManagementPublishEntitlement>;
  findById(id: string): Promise<ManagementPublishEntitlement | null>;
  findByPurchaseId(purchaseId: string): Promise<ManagementPublishEntitlement | null>;
  /** The live (non-refunded, non-revoked) unlock for one content item. */
  findLiveForContent(
    userId: string,
    managementContentId: string
  ): Promise<ManagementPublishEntitlement | null>;
  findByUserId(userId: string): Promise<ManagementPublishEntitlement[]>;
  updateStatus(
    id: string,
    status: ManagementPublishEntitlementStatus,
    fields?: { revokedAt?: Date | null; revokedReason?: string | null }
  ): Promise<ManagementPublishEntitlement>;
}

/**
 * Consumable, expiring upload-token bundles (the entry product).
 *
 * Unlike a permanent single-video unlock, a bundle IS used up: `consume`
 * decrements `remaining`, and the storage-level CHECKs make an over-spend or a
 * negative balance impossible even under a racing double-publish.
 */
export interface IManagementUploadBundleRepository {
  /**
   * Grant a bundle for a purchase, or return the existing one when the purchase
   * has already been activated (UNIQUE(purchase_id)). `created` tells the caller
   * whether this call performed the grant, so a replayed checkout never grants a
   * second allowance for one payment.
   */
  createOrGetByPurchase(input: {
    userId: string;
    managementProductId: string;
    productCode: ManagementProductCode;
    purchaseId: string;
    creditTransactionId: string | null;
    totalAllowance: number;
    startsAt: Date;
    expiresAt: Date;
  }): Promise<{ bundle: ManagementUploadBundle; created: boolean }>;

  findById(id: string): Promise<ManagementUploadBundle | null>;
  findByPurchaseId(purchaseId: string): Promise<ManagementUploadBundle | null>;
  findByUserId(userId: string): Promise<ManagementUploadBundle[]>;

  /**
   * The user's spendable bundles — active, in-window, with tokens left — oldest
   * expiring first so tokens are consumed FIFO.
   */
  findSpendable(userId: string, now: Date): Promise<ManagementUploadBundle[]>;

  /** Total spendable tokens across all of a user's live bundles. */
  countSpendableTokens(userId: string, now: Date): Promise<number>;

  /**
   * Atomically spend `count` tokens across the user's spendable bundles, FIFO.
   *
   * Returns one bundle id per token spent (length === count), so the caller can
   * stamp each publication target with the bundle that paid for it. Returns null
   * — spending NOTHING — when the user has fewer than `count` spendable tokens,
   * so this doubles as the final, race-proof guard behind `evaluateForPublish`.
   */
  consume(userId: string, count: number, now: Date): Promise<string[] | null>;

  updateStatus(
    id: string,
    status: ManagementUploadBundleStatus
  ): Promise<ManagementUploadBundle>;

  /**
   * Flip elapsed `active` bundles to `expired`. Housekeeping only — spendability
   * is decided by comparing timestamps, so tokens are correct even if this has
   * never run.
   */
  markElapsedExpired(now: Date): Promise<number>;
}

export interface IManagementContentRepository {
  /**
   * Idempotent transfer: returns the existing live item for (user, generation)
   * when one exists, otherwise inserts. `created` tells the caller whether this
   * call performed the transfer.
   */
  createOrGetTransferred(input: {
    userId: string;
    sourceGenerationId: string;
    title: string;
    description: string | null;
    thumbnailStorageKey: string | null;
    mediaExpiresAt: Date;
  }): Promise<{ item: ManagementContentItem; created: boolean }>;

  /**
   * Idempotent per-video transfer: returns the existing live item for
   * (user, generation, sourceAssetId) when one exists, otherwise inserts. This
   * is what lets one project be transferred as several independent items — one
   * per generated export — rather than a single item holding every format.
   */
  createOrGetTransferredVideo(input: {
    userId: string;
    sourceGenerationId: string;
    sourceAssetId: string;
    title: string;
    description: string | null;
    /** Seeded from the generation post kit; blank for an upload. */
    defaultCaption?: string | null;
    defaultHashtags?: string[];
    thumbnailStorageKey: string | null;
    mediaExpiresAt: Date;
  }): Promise<{ item: ManagementContentItem; created: boolean }>;

  /**
   * Create an item for a user-uploaded video. Uploads are not deduplicated —
   * a user may hold as many as they like — so this always inserts.
   */
  createUploaded(input: {
    userId: string;
    title: string;
    description: string | null;
    mediaExpiresAt: Date;
  }): Promise<ManagementContentItem>;

  findById(id: string): Promise<ManagementContentItem | null>;
  findBySource(
    userId: string,
    sourceGenerationId: string
  ): Promise<ManagementContentItem | null>;
  /** The live per-video item for one specific generated export, or null. */
  findBySourceVideo(
    userId: string,
    sourceGenerationId: string,
    sourceAssetId: string
  ): Promise<ManagementContentItem | null>;
  /** Every live item transferred from one project (one per video). */
  findAllBySource(
    userId: string,
    sourceGenerationId: string
  ): Promise<ManagementContentItem[]>;
  /** A user's LIVE (not soft-removed) library, newest first. */
  findByUserId(userId: string): Promise<ManagementContentItem[]>;
  /** How many of a user's videos have been soft-removed. */
  countRemoved(userId: string): Promise<number>;
  updateStatus(id: string, status: ManagementContentStatus): Promise<ManagementContentItem>;
  update(
    id: string,
    fields: {
      title?: string;
      description?: string | null;
      defaultCaption?: string | null;
      defaultHashtags?: string[];
      thumbnailStorageKey?: string | null;
      mediaExpiresAt?: Date | null;
      mediaDeletedAt?: Date | null;
    }
  ): Promise<ManagementContentItem>;
  /** Soft-delete: mark the video removed from the user's library. Idempotent. */
  softRemove(id: string): Promise<ManagementContentItem>;

  /** Replace the variant rows for an item, pinning any generator media used. */
  replaceAssets(
    managementContentId: string,
    assets: Omit<
      ManagementContentAsset,
      "id" | "managementContentId" | "createdAt" | "updatedAt"
    >[]
  ): Promise<ManagementContentAsset[]>;
  findAssets(managementContentId: string): Promise<ManagementContentAsset[]>;

  /**
   * Replace the server-derived recommendation snapshot for a transferred video.
   * These are hints only and never create publication targets by themselves.
   */
  replaceChannelSuggestions(
    managementContentId: string,
    suggestions: Omit<
      ManagementChannelSuggestion,
      "id" | "managementContentId" | "createdAt" | "updatedAt"
    >[]
  ): Promise<ManagementChannelSuggestion[]>;
  findChannelSuggestions(
    managementContentId: string
  ): Promise<ManagementChannelSuggestion[]>;

  /** Repoint one asset at a new storage key, e.g. after the file is moved. */
  updateAssetStorageKey(assetId: string, storageKey: string): Promise<void>;

  /**
   * Items whose media window has elapsed and which have no pending or scheduled
   * publication still needing the file. Drives the media purge.
   */
  findMediaExpiryCandidates(now: Date, limit: number): Promise<ManagementContentItem[]>;
}

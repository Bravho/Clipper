/**
 * PostgreSQL implementations of the RClipper Management repositories.
 *
 * Style follows the existing Postgres repositories: raw `pg`, hand-written SQL,
 * a `rowTo…` mapper per aggregate, and no ORM.
 *
 * CONCURRENCY NOTES
 *   Several methods use `ON CONFLICT … DO NOTHING` + re-select rather than a
 *   read-then-write. That is deliberate: the uniqueness guarantees live in the
 *   database (migration 019), so two concurrent requests racing to create the
 *   same purchase, unlock or content item converge on one row instead of both
 *   "checking first" and both inserting.
 */

import { pool } from "@/lib/db";
import type { PoolClient } from "pg";
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
import {
  ManagementAccessPassStatus,
  ManagementContentStatus,
  ManagementPublishEntitlementStatus,
  ManagementSourceType,
  ManagementUploadBundleStatus,
} from "@/domain/enums/ManagementStatus";
import type {
  IManagementAccessPassRepository,
  IManagementContentRepository,
  IManagementProductRepository,
  IManagementPublishEntitlementRepository,
  IManagementPurchaseRepository,
  IManagementUploadBundleRepository,
} from "@/repositories/interfaces/IManagementRepositories";

type Row = Record<string, unknown>;

const asDate = (v: unknown): Date => new Date(v as string);
const asDateOrNull = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const asNumOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

// ── Products ─────────────────────────────────────────────────────────────────

function rowToProduct(row: Row): ManagementProduct {
  return {
    id: row.id as string,
    code: row.code as ManagementProductCode,
    name: row.name as string,
    description: (row.description as string) ?? "",
    productType: row.product_type as "single_video" | "access_pass",
    durationMonths: asNumOrNull(row.duration_months),
    uploadAllowance: asNumOrNull(row.upload_allowance),
    accessWindowDays: asNumOrNull(row.access_window_days),
    priceCredits: Number(row.price_credits),
    fullPriceCredits: Number(row.full_price_credits),
    currency: row.currency as string,
    isActive: row.is_active as boolean,
    sortOrder: Number(row.sort_order),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export class PostgresManagementProductRepository implements IManagementProductRepository {
  constructor(private db = pool) {}

  async findByCode(code: ManagementProductCode): Promise<ManagementProduct | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_products WHERE code = $1 AND is_active = TRUE",
      [code]
    );
    return rows[0] ? rowToProduct(rows[0]) : null;
  }

  async listActive(): Promise<ManagementProduct[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_products WHERE is_active = TRUE ORDER BY sort_order ASC"
    );
    return rows.map(rowToProduct);
  }
}

// ── Purchases ────────────────────────────────────────────────────────────────

function rowToPurchase(row: Row): ManagementPurchase {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    managementProductId: row.management_product_id as string,
    productCode: row.product_code as ManagementProductCode,
    managementContentId: (row.management_content_id as string) ?? null,
    status: row.status as ManagementPurchaseStatus,
    amountCredits: Number(row.amount_credits),
    currency: row.currency as string,
    idempotencyKey: row.idempotency_key as string,
    creditTransactionId: (row.credit_transaction_id as string) ?? null,
    paidAt: asDateOrNull(row.paid_at),
    failureReason: (row.failure_reason as string) ?? null,
    refundedAt: asDateOrNull(row.refunded_at),
    refundCreditTransactionId: (row.refund_credit_transaction_id as string) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export class PostgresManagementPurchaseRepository implements IManagementPurchaseRepository {
  constructor(private db = pool) {}

  async createOrGetByIdempotencyKey(
    input: CreateManagementPurchaseInput
  ): Promise<{ purchase: ManagementPurchase; created: boolean }> {
    const inserted = await this.db.query(
      `INSERT INTO management_purchases
         (user_id, management_product_id, product_code, management_content_id,
          status, amount_credits, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        input.userId,
        input.managementProductId,
        input.productCode,
        input.managementContentId,
        ManagementPurchaseStatus.Pending,
        input.amountCredits,
        input.idempotencyKey,
      ]
    );
    if (inserted.rows[0]) {
      return { purchase: rowToPurchase(inserted.rows[0]), created: true };
    }

    const { rows } = await this.db.query(
      "SELECT * FROM management_purchases WHERE idempotency_key = $1",
      [input.idempotencyKey]
    );
    if (!rows[0]) throw new Error("Management purchase could not be created or found.");
    const existing = rowToPurchase(rows[0]);
    // Defence in depth: the key is derived from the user id, so a mismatch means
    // a collision or tampering, not a normal retry.
    if (existing.userId !== input.userId) {
      throw new Error("Management purchase belongs to another account.");
    }
    return { purchase: existing, created: false };
  }

  async findById(id: string): Promise<ManagementPurchase | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_purchases WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToPurchase(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<ManagementPurchase[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_purchases WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return rows.map(rowToPurchase);
  }

  async updateStatus(
    id: string,
    status: ManagementPurchaseStatus,
    fields?: {
      creditTransactionId?: string | null;
      paidAt?: Date | null;
      failureReason?: string | null;
      refundedAt?: Date | null;
      refundCreditTransactionId?: string | null;
    }
  ): Promise<ManagementPurchase> {
    const { rows } = await this.db.query(
      `UPDATE management_purchases
          SET status = $2,
              credit_transaction_id = COALESCE($3, credit_transaction_id),
              paid_at        = COALESCE($4, paid_at),
              failure_reason = $5,
              refunded_at    = COALESCE($6, refunded_at),
              refund_credit_transaction_id = COALESCE($7, refund_credit_transaction_id),
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [
        id,
        status,
        fields?.creditTransactionId ?? null,
        fields?.paidAt ?? null,
        fields?.failureReason ?? null,
        fields?.refundedAt ?? null,
        fields?.refundCreditTransactionId ?? null,
      ]
    );
    if (!rows[0]) throw new Error("Management purchase not found.");
    return rowToPurchase(rows[0]);
  }
}

// ── Access passes ────────────────────────────────────────────────────────────

function rowToPass(row: Row): ManagementAccessPass {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    managementProductId: row.management_product_id as string,
    productCode: row.product_code as ManagementProductCode,
    creditTransactionId: (row.credit_transaction_id as string) ?? null,
    purchaseId: row.purchase_id as string,
    status: row.status as ManagementAccessPassStatus,
    startsAt: asDate(row.starts_at),
    expiresAt: asDate(row.expires_at),
    revokedAt: asDateOrNull(row.revoked_at),
    revokedReason: (row.revoked_reason as string) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export class PostgresManagementAccessPassRepository
  implements IManagementAccessPassRepository
{
  constructor(private db = pool) {}

  async create(input: {
    userId: string;
    managementProductId: string;
    productCode: ManagementProductCode;
    purchaseId: string;
    creditTransactionId: string | null;
    startsAt: Date;
    expiresAt: Date;
  }): Promise<ManagementAccessPass> {
    // UNIQUE(purchase_id) means a replayed activation returns the pass that
    // already exists instead of granting a second window for one payment.
    const inserted = await this.db.query(
      `INSERT INTO management_access_passes
         (user_id, management_product_id, product_code, purchase_id,
          credit_transaction_id, status, starts_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (purchase_id) DO NOTHING
       RETURNING *`,
      [
        input.userId,
        input.managementProductId,
        input.productCode,
        input.purchaseId,
        input.creditTransactionId,
        ManagementAccessPassStatus.Active,
        input.startsAt,
        input.expiresAt,
      ]
    );
    if (inserted.rows[0]) return rowToPass(inserted.rows[0]);

    const existing = await this.findByPurchaseId(input.purchaseId);
    if (!existing) throw new Error("Access pass could not be created or found.");
    return existing;
  }

  async findById(id: string): Promise<ManagementAccessPass | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_access_passes WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToPass(rows[0]) : null;
  }

  async findByPurchaseId(purchaseId: string): Promise<ManagementAccessPass | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_access_passes WHERE purchase_id = $1",
      [purchaseId]
    );
    return rows[0] ? rowToPass(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<ManagementAccessPass[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_access_passes WHERE user_id = $1 ORDER BY expires_at DESC",
      [userId]
    );
    return rows.map(rowToPass);
  }

  async findEffectiveExpiry(
    userId: string
  ): Promise<{ passId: string; startsAt: Date; expiresAt: Date } | null> {
    // The furthest-future expiry across live passes. Revoked and refunded rows
    // are excluded by the status filter, so revoking a pass immediately shrinks
    // the effective window without touching any other row.
    const { rows } = await this.db.query(
      `SELECT id, starts_at, expires_at
         FROM management_access_passes
        WHERE user_id = $1 AND status = $2 AND revoked_at IS NULL
        ORDER BY expires_at DESC
        LIMIT 1`,
      [userId, ManagementAccessPassStatus.Active]
    );
    if (!rows[0]) return null;
    return {
      passId: rows[0].id as string,
      startsAt: asDate(rows[0].starts_at),
      expiresAt: asDate(rows[0].expires_at),
    };
  }

  async updateStatus(
    id: string,
    status: ManagementAccessPassStatus,
    fields?: { revokedAt?: Date | null; revokedReason?: string | null }
  ): Promise<ManagementAccessPass> {
    const { rows } = await this.db.query(
      `UPDATE management_access_passes
          SET status = $2,
              revoked_at = COALESCE($3, revoked_at),
              revoked_reason = COALESCE($4, revoked_reason),
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [id, status, fields?.revokedAt ?? null, fields?.revokedReason ?? null]
    );
    if (!rows[0]) throw new Error("Access pass not found.");
    return rowToPass(rows[0]);
  }

  async markElapsedExpired(now: Date): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE management_access_passes
          SET status = $1, updated_at = NOW()
        WHERE status = $2 AND expires_at <= $3`,
      [ManagementAccessPassStatus.Expired, ManagementAccessPassStatus.Active, now]
    );
    return rowCount ?? 0;
  }
}

// ── Publish entitlements (permanent single-video unlocks) ────────────────────

function rowToPublishEntitlement(row: Row): ManagementPublishEntitlement {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    managementContentId: row.management_content_id as string,
    managementProductId: row.management_product_id as string,
    creditTransactionId: (row.credit_transaction_id as string) ?? null,
    purchaseId: row.purchase_id as string,
    status: row.status as ManagementPublishEntitlementStatus,
    revokedAt: asDateOrNull(row.revoked_at),
    revokedReason: (row.revoked_reason as string) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export class PostgresManagementPublishEntitlementRepository
  implements IManagementPublishEntitlementRepository
{
  constructor(private db = pool) {}

  async create(input: {
    userId: string;
    managementContentId: string;
    managementProductId: string;
    purchaseId: string;
    creditTransactionId: string | null;
  }): Promise<ManagementPublishEntitlement> {
    const inserted = await this.db.query(
      `INSERT INTO management_publish_entitlements
         (user_id, management_content_id, management_product_id, purchase_id,
          credit_transaction_id, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (purchase_id) DO NOTHING
       RETURNING *`,
      [
        input.userId,
        input.managementContentId,
        input.managementProductId,
        input.purchaseId,
        input.creditTransactionId,
        ManagementPublishEntitlementStatus.Paid,
      ]
    );
    if (inserted.rows[0]) return rowToPublishEntitlement(inserted.rows[0]);

    const existing = await this.findByPurchaseId(input.purchaseId);
    if (!existing) throw new Error("Publish entitlement could not be created or found.");
    return existing;
  }

  async findById(id: string): Promise<ManagementPublishEntitlement | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_publish_entitlements WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToPublishEntitlement(rows[0]) : null;
  }

  async findByPurchaseId(
    purchaseId: string
  ): Promise<ManagementPublishEntitlement | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_publish_entitlements WHERE purchase_id = $1",
      [purchaseId]
    );
    return rows[0] ? rowToPublishEntitlement(rows[0]) : null;
  }

  async findLiveForContent(
    userId: string,
    managementContentId: string
  ): Promise<ManagementPublishEntitlement | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_publish_entitlements
        WHERE user_id = $1 AND management_content_id = $2 AND status = $3
        LIMIT 1`,
      [userId, managementContentId, ManagementPublishEntitlementStatus.Paid]
    );
    return rows[0] ? rowToPublishEntitlement(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<ManagementPublishEntitlement[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_publish_entitlements
        WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(rowToPublishEntitlement);
  }

  async updateStatus(
    id: string,
    status: ManagementPublishEntitlementStatus,
    fields?: { revokedAt?: Date | null; revokedReason?: string | null }
  ): Promise<ManagementPublishEntitlement> {
    const { rows } = await this.db.query(
      `UPDATE management_publish_entitlements
          SET status = $2,
              revoked_at = COALESCE($3, revoked_at),
              revoked_reason = COALESCE($4, revoked_reason),
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [id, status, fields?.revokedAt ?? null, fields?.revokedReason ?? null]
    );
    if (!rows[0]) throw new Error("Publish entitlement not found.");
    return rowToPublishEntitlement(rows[0]);
  }
}

// ── Upload bundles (consumable entry product) ────────────────────────────────

function rowToBundle(row: Row): ManagementUploadBundle {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    managementProductId: row.management_product_id as string,
    productCode: row.product_code as ManagementProductCode,
    purchaseId: row.purchase_id as string,
    creditTransactionId: (row.credit_transaction_id as string) ?? null,
    totalAllowance: Number(row.total_allowance),
    remaining: Number(row.remaining),
    startsAt: asDate(row.starts_at),
    expiresAt: asDate(row.expires_at),
    status: row.status as ManagementUploadBundleStatus,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export class PostgresManagementUploadBundleRepository
  implements IManagementUploadBundleRepository
{
  constructor(private db = pool) {}

  async createOrGetByPurchase(input: {
    userId: string;
    managementProductId: string;
    productCode: ManagementProductCode;
    purchaseId: string;
    creditTransactionId: string | null;
    totalAllowance: number;
    startsAt: Date;
    expiresAt: Date;
  }): Promise<{ bundle: ManagementUploadBundle; created: boolean }> {
    // UNIQUE(purchase_id) means a replayed activation returns the bundle that
    // already exists instead of granting a second allowance for one payment.
    const inserted = await this.db.query(
      `INSERT INTO management_upload_bundles
         (user_id, management_product_id, product_code, purchase_id,
          credit_transaction_id, total_allowance, remaining, starts_at, expires_at,
          status)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)
       ON CONFLICT (purchase_id) DO NOTHING
       RETURNING *`,
      [
        input.userId,
        input.managementProductId,
        input.productCode,
        input.purchaseId,
        input.creditTransactionId,
        input.totalAllowance,
        input.startsAt,
        input.expiresAt,
        ManagementUploadBundleStatus.Active,
      ]
    );
    if (inserted.rows[0]) {
      return { bundle: rowToBundle(inserted.rows[0]), created: true };
    }

    const existing = await this.findByPurchaseId(input.purchaseId);
    if (!existing) throw new Error("Upload bundle could not be created or found.");
    return { bundle: existing, created: false };
  }

  async findById(id: string): Promise<ManagementUploadBundle | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_upload_bundles WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToBundle(rows[0]) : null;
  }

  async findByPurchaseId(purchaseId: string): Promise<ManagementUploadBundle | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_upload_bundles WHERE purchase_id = $1",
      [purchaseId]
    );
    return rows[0] ? rowToBundle(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<ManagementUploadBundle[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_upload_bundles WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return rows.map(rowToBundle);
  }

  async findSpendable(userId: string, now: Date): Promise<ManagementUploadBundle[]> {
    // Active, in-window, tokens left — oldest expiring first so the soonest-to-
    // expire allowance is spent before one with more life in it (FIFO).
    const { rows } = await this.db.query(
      `SELECT * FROM management_upload_bundles
        WHERE user_id = $1 AND status = $2 AND remaining > 0 AND expires_at > $3
        ORDER BY expires_at ASC, created_at ASC`,
      [userId, ManagementUploadBundleStatus.Active, now]
    );
    return rows.map(rowToBundle);
  }

  async countSpendableTokens(userId: string, now: Date): Promise<number> {
    const { rows } = await this.db.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(remaining), 0) AS total
         FROM management_upload_bundles
        WHERE user_id = $1 AND status = $2 AND remaining > 0 AND expires_at > $3`,
      [userId, ManagementUploadBundleStatus.Active, now]
    );
    return Number(rows[0]?.total ?? 0);
  }

  async consume(userId: string, count: number, now: Date): Promise<string[] | null> {
    if (count <= 0) return [];

    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");

      // Lock the spendable bundles so two concurrent publishes cannot both read
      // the same remaining balance and over-spend. FIFO by expiry.
      const { rows } = await client.query(
        `SELECT id, remaining
           FROM management_upload_bundles
          WHERE user_id = $1 AND status = $2 AND remaining > 0 AND expires_at > $3
          ORDER BY expires_at ASC, created_at ASC
          FOR UPDATE`,
        [userId, ManagementUploadBundleStatus.Active, now]
      );

      const available = rows.reduce((sum, r) => sum + Number(r.remaining), 0);
      if (available < count) {
        // Not enough tokens. Spend nothing — this is the race-proof guard.
        await client.query("ROLLBACK");
        return null;
      }

      const allocations: string[] = [];
      let needed = count;
      for (const row of rows) {
        if (needed === 0) break;
        const bundleId = row.id as string;
        const take = Math.min(needed, Number(row.remaining));
        // Guarded decrement — the CHECK (remaining >= 0) is the storage-level
        // backstop should the FOR UPDATE ever be bypassed.
        await client.query(
          `UPDATE management_upload_bundles
              SET remaining = remaining - $2, updated_at = NOW()
            WHERE id = $1 AND remaining >= $2`,
          [bundleId, take]
        );
        for (let i = 0; i < take; i++) allocations.push(bundleId);
        needed -= take;
      }

      await client.query("COMMIT");
      return allocations;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async updateStatus(
    id: string,
    status: ManagementUploadBundleStatus
  ): Promise<ManagementUploadBundle> {
    const { rows } = await this.db.query(
      `UPDATE management_upload_bundles
          SET status = $2, updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [id, status]
    );
    if (!rows[0]) throw new Error("Upload bundle not found.");
    return rowToBundle(rows[0]);
  }

  async markElapsedExpired(now: Date): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE management_upload_bundles
          SET status = $1, updated_at = NOW()
        WHERE status = $2 AND expires_at <= $3`,
      [ManagementUploadBundleStatus.Expired, ManagementUploadBundleStatus.Active, now]
    );
    return rowCount ?? 0;
  }
}

// ── Content items and assets ─────────────────────────────────────────────────

function rowToContent(row: Row): ManagementContentItem {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    sourceType: row.source_type as ManagementSourceType,
    sourceGenerationId: (row.source_generation_id as string) ?? null,
    sourceAssetId: (row.source_asset_id as string) ?? null,
    title: row.title as string,
    description: (row.description as string) ?? null,
    defaultCaption: (row.default_caption as string) ?? null,
    defaultHashtags: (row.default_hashtags as string[]) ?? [],
    thumbnailStorageKey: (row.thumbnail_storage_key as string) ?? null,
    status: row.status as ManagementContentStatus,
    removedAt: asDateOrNull(row.removed_at),
    mediaExpiresAt: asDateOrNull(row.media_expires_at),
    mediaDeletedAt: asDateOrNull(row.media_deleted_at),
    transferredAt: asDateOrNull(row.transferred_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function rowToAsset(row: Row): ManagementContentAsset {
  return {
    id: row.id as string,
    managementContentId: row.management_content_id as string,
    sourceVideoId: (row.source_video_id as string) ?? null,
    platformVariant: row.platform_variant as string,
    storageKey: row.storage_key as string,
    mimeType: (row.mime_type as string) ?? null,
    width: asNumOrNull(row.width),
    height: asNumOrNull(row.height),
    durationSeconds: asNumOrNull(row.duration_seconds),
    aspectRatio: (row.aspect_ratio as string) ?? null,
    originalFilename: (row.original_filename as string) ?? null,
    fileSizeBytes: asNumOrNull(row.file_size_bytes),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function rowToChannelSuggestion(row: Row): ManagementChannelSuggestion {
  return {
    id: row.id as string,
    managementContentId: row.management_content_id as string,
    platform: row.platform as string,
    displayOrder: Number(row.display_order),
    title: (row.title as string) ?? null,
    caption: (row.caption as string) ?? null,
    hashtags: (row.hashtags as string[]) ?? [],
    locale: (row.locale as string) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export class PostgresManagementContentRepository implements IManagementContentRepository {
  constructor(private db = pool) {}

  async createOrGetTransferred(input: {
    userId: string;
    sourceGenerationId: string;
    title: string;
    description: string | null;
    thumbnailStorageKey: string | null;
    mediaExpiresAt: Date;
  }): Promise<{ item: ManagementContentItem; created: boolean }> {
    // uq_mgmt_content_per_source is the real guard: two concurrent transfers of
    // the same project converge on one content item.
    const inserted = await this.db.query(
      `INSERT INTO management_content_items
         (user_id, source_type, source_generation_id, title, description,
          thumbnail_storage_key, status, media_expires_at, transferred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        input.userId,
        ManagementSourceType.RClipperGeneration,
        input.sourceGenerationId,
        input.title,
        input.description,
        input.thumbnailStorageKey,
        ManagementContentStatus.Ready,
        input.mediaExpiresAt,
      ]
    );
    if (inserted.rows[0]) {
      return { item: rowToContent(inserted.rows[0]), created: true };
    }

    const existing = await this.findBySource(input.userId, input.sourceGenerationId);
    if (!existing) throw new Error("Management content item could not be created or found.");
    return { item: existing, created: false };
  }

  async createOrGetTransferredVideo(input: {
    userId: string;
    sourceGenerationId: string;
    sourceAssetId: string;
    title: string;
    description: string | null;
    defaultCaption?: string | null;
    defaultHashtags?: string[];
    thumbnailStorageKey: string | null;
    mediaExpiresAt: Date;
  }): Promise<{ item: ManagementContentItem; created: boolean }> {
    // uq_mgmt_content_per_source_video is the guard: two concurrent transfers of
    // the same export converge on one item.
    const inserted = await this.db.query(
      `INSERT INTO management_content_items
         (user_id, source_type, source_generation_id, source_asset_id, title,
          description, default_caption, default_hashtags, thumbnail_storage_key,
          status, media_expires_at, transferred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        input.userId,
        ManagementSourceType.RClipperGeneration,
        input.sourceGenerationId,
        input.sourceAssetId,
        input.title,
        input.description,
        input.defaultCaption ?? null,
        input.defaultHashtags ?? [],
        input.thumbnailStorageKey,
        ManagementContentStatus.Ready,
        input.mediaExpiresAt,
      ]
    );
    if (inserted.rows[0]) {
      return { item: rowToContent(inserted.rows[0]), created: true };
    }

    const existing = await this.findBySourceVideo(
      input.userId,
      input.sourceGenerationId,
      input.sourceAssetId
    );
    if (!existing) {
      throw new Error("Management content item could not be created or found.");
    }
    return { item: existing, created: false };
  }

  async createUploaded(input: {
    userId: string;
    title: string;
    description: string | null;
    mediaExpiresAt: Date;
  }): Promise<ManagementContentItem> {
    // Uploads are never deduplicated — a user may hold as many as they like.
    // Starts in `uploading`; the upload-completion step flips it to `ready`.
    const { rows } = await this.db.query(
      `INSERT INTO management_content_items
         (user_id, source_type, source_generation_id, title, description,
          status, media_expires_at)
       VALUES ($1,$2,NULL,$3,$4,$5,$6)
       RETURNING *`,
      [
        input.userId,
        ManagementSourceType.UserUpload,
        input.title,
        input.description,
        ManagementContentStatus.Uploading,
        input.mediaExpiresAt,
      ]
    );
    return rowToContent(rows[0]);
  }

  async findById(id: string): Promise<ManagementContentItem | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_content_items WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToContent(rows[0]) : null;
  }

  async findBySource(
    userId: string,
    sourceGenerationId: string
  ): Promise<ManagementContentItem | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_content_items
        WHERE user_id = $1 AND source_generation_id = $2 AND status <> $3
        LIMIT 1`,
      [userId, sourceGenerationId, ManagementContentStatus.Cancelled]
    );
    return rows[0] ? rowToContent(rows[0]) : null;
  }

  async findBySourceVideo(
    userId: string,
    sourceGenerationId: string,
    sourceAssetId: string
  ): Promise<ManagementContentItem | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_content_items
        WHERE user_id = $1 AND source_generation_id = $2 AND source_asset_id = $3
          AND status <> $4
        LIMIT 1`,
      [userId, sourceGenerationId, sourceAssetId, ManagementContentStatus.Cancelled]
    );
    return rows[0] ? rowToContent(rows[0]) : null;
  }

  async findAllBySource(
    userId: string,
    sourceGenerationId: string
  ): Promise<ManagementContentItem[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_content_items
        WHERE user_id = $1 AND source_generation_id = $2 AND status <> $3
        ORDER BY created_at ASC`,
      [userId, sourceGenerationId, ManagementContentStatus.Cancelled]
    );
    return rows.map(rowToContent);
  }

  async findByUserId(userId: string): Promise<ManagementContentItem[]> {
    // Soft-removed videos are excluded from the library. Their records and
    // publishing history remain, and are still reachable by id.
    const { rows } = await this.db.query(
      `SELECT * FROM management_content_items
        WHERE user_id = $1 AND removed_at IS NULL
        ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(rowToContent);
  }

  async countRemoved(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM management_content_items
        WHERE user_id = $1 AND removed_at IS NOT NULL`,
      [userId]
    );
    return Number(rows[0]?.count ?? 0);
  }

  async softRemove(id: string): Promise<ManagementContentItem> {
    // COALESCE keeps the first removal time if called twice (idempotent).
    const { rows } = await this.db.query(
      `UPDATE management_content_items
          SET removed_at = COALESCE(removed_at, NOW()), updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [id]
    );
    if (!rows[0]) throw new Error("Management content item not found.");
    return rowToContent(rows[0]);
  }

  async updateStatus(
    id: string,
    status: ManagementContentStatus
  ): Promise<ManagementContentItem> {
    const { rows } = await this.db.query(
      `UPDATE management_content_items
          SET status = $2, updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [id, status]
    );
    if (!rows[0]) throw new Error("Management content item not found.");
    return rowToContent(rows[0]);
  }

  async update(
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
  ): Promise<ManagementContentItem> {
    // description/default_caption use a sentinel: `undefined` means "leave as-is"
    // while an explicit null/"" clears the field. COALESCE alone could not clear
    // them. We pass the value only when the key is present.
    const setDescription = fields.description !== undefined;
    const setCaption = fields.defaultCaption !== undefined;
    const setHashtags = fields.defaultHashtags !== undefined;
    const { rows } = await this.db.query(
      `UPDATE management_content_items
          SET title                 = COALESCE($2, title),
              description           = CASE WHEN $3 THEN $4 ELSE description END,
              default_caption       = CASE WHEN $5 THEN $6 ELSE default_caption END,
              default_hashtags      = CASE WHEN $7 THEN $8::text[] ELSE default_hashtags END,
              thumbnail_storage_key = COALESCE($9, thumbnail_storage_key),
              media_expires_at      = COALESCE($10, media_expires_at),
              media_deleted_at      = COALESCE($11, media_deleted_at),
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [
        id,
        fields.title ?? null,
        setDescription,
        fields.description ?? null,
        setCaption,
        fields.defaultCaption ?? null,
        setHashtags,
        fields.defaultHashtags ?? [],
        fields.thumbnailStorageKey ?? null,
        fields.mediaExpiresAt ?? null,
        fields.mediaDeletedAt ?? null,
      ]
    );
    if (!rows[0]) throw new Error("Management content item not found.");
    return rowToContent(rows[0]);
  }

  async replaceAssets(
    managementContentId: string,
    assets: Omit<
      ManagementContentAsset,
      "id" | "managementContentId" | "createdAt" | "updatedAt"
    >[]
  ): Promise<ManagementContentAsset[]> {
    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM management_content_assets WHERE management_content_id = $1",
        [managementContentId]
      );

      const created: ManagementContentAsset[] = [];
      for (const asset of assets) {
        const { rows } = await client.query(
          `INSERT INTO management_content_assets
             (management_content_id, source_video_id, platform_variant, storage_key,
              mime_type, width, height, duration_seconds, aspect_ratio,
              original_filename, file_size_bytes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            managementContentId,
            asset.sourceVideoId,
            asset.platformVariant,
            asset.storageKey,
            asset.mimeType,
            asset.width,
            asset.height,
            asset.durationSeconds,
            asset.aspectRatio,
            asset.originalFilename,
            asset.fileSizeBytes,
          ]
        );
        created.push(rowToAsset(rows[0]));
      }

      // Pin the generator's media so the clip-request sweep cannot delete a
      // video that Management is still holding. Uploads have no
      // `uploaded_assets` row and are governed by `media_expires_at` instead.
      const generatorAssetIds = assets
        .map((a) => a.sourceVideoId)
        .filter((id): id is string => !!id);
      if (generatorAssetIds.length > 0) {
        await client.query(
          `UPDATE uploaded_assets SET retention_pinned = TRUE WHERE id = ANY($1)`,
          [generatorAssetIds]
        );
      }

      await client.query("COMMIT");
      return created;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findAssets(managementContentId: string): Promise<ManagementContentAsset[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_content_assets
        WHERE management_content_id = $1
        ORDER BY platform_variant ASC`,
      [managementContentId]
    );
    return rows.map(rowToAsset);
  }

  async replaceChannelSuggestions(
    managementContentId: string,
    suggestions: Omit<
      ManagementChannelSuggestion,
      "id" | "managementContentId" | "createdAt" | "updatedAt"
    >[]
  ): Promise<ManagementChannelSuggestion[]> {
    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM management_content_channel_suggestions WHERE management_content_id = $1",
        [managementContentId]
      );

      const rows: ManagementChannelSuggestion[] = [];
      for (const suggestion of suggestions) {
        const inserted = await client.query(
          `INSERT INTO management_content_channel_suggestions
             (management_content_id, platform, display_order, title, caption,
              hashtags, locale)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            managementContentId,
            suggestion.platform,
            suggestion.displayOrder,
            suggestion.title,
            suggestion.caption,
            suggestion.hashtags,
            suggestion.locale,
          ]
        );
        rows.push(rowToChannelSuggestion(inserted.rows[0]));
      }

      await client.query("COMMIT");
      return rows;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findChannelSuggestions(
    managementContentId: string
  ): Promise<ManagementChannelSuggestion[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_content_channel_suggestions
        WHERE management_content_id = $1
        ORDER BY display_order ASC, created_at ASC`,
      [managementContentId]
    );
    return rows.map(rowToChannelSuggestion);
  }

  async updateAssetStorageKey(assetId: string, storageKey: string): Promise<void> {
    await this.db.query(
      `UPDATE management_content_assets
          SET storage_key = $2, updated_at = NOW()
        WHERE id = $1`,
      [assetId, storageKey]
    );
  }

  async findMediaExpiryCandidates(
    now: Date,
    limit: number
  ): Promise<ManagementContentItem[]> {
    // Past its window, not already purged, and with NO publication still
    // waiting to go out. A scheduled post keeps its media alive past the
    // window — expiring a file out from under a post the user already paid for
    // would be a broken promise, not a storage saving.
    const { rows } = await this.db.query(
      `SELECT c.* FROM management_content_items c
        WHERE c.media_expires_at IS NOT NULL
          AND c.media_expires_at <= $1
          AND c.media_deleted_at IS NULL
          AND c.status <> $2
          AND NOT EXISTS (
                SELECT 1 FROM management_publications p
                 WHERE p.management_content_id = c.id
                   AND p.status IN ('draft','scheduled','publishing')
              )
        ORDER BY c.media_expires_at ASC
        LIMIT $3`,
      [now, ManagementContentStatus.MediaExpired, limit]
    );
    return rows.map(rowToContent);
  }
}

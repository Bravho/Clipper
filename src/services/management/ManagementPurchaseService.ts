/**
 * ManagementPurchaseService — buying publishing rights with credits.
 *
 * WHEN THIS RUNS: at publish time. Transferring a generation project into
 * Management and uploading your own video are both free, so nothing here is
 * reachable until a user actually tries to send a video to social channels.
 *
 * WHY CREDITS. Credits only ever enter a wallet through an already-verified
 * rail: a signature-verified Stripe webhook on web, or server-side Apple /
 * Google receipt verification in the native shells. Spending them here is a
 * wallet debit, which means Management needs no second payment provider, no
 * price objects, no new webhook — and stays store-policy compliant on iOS and
 * Android, because in-app money still enters through the platform's own billing.
 *
 * EVERY PURCHASE IS ONE-TIME. There is no subscription object in this file or
 * the schema behind it, no renewal timer, and no path that can charge a user a
 * second time. When an access pass expires, nothing happens except that new
 * publications stop being permitted.
 *
 * THE CLIENT SENDS A PRODUCT CODE AND NOTHING ELSE. Price, duration, currency
 * and entitlement type are read from `management_products`. A client-supplied
 * amount, duration, currency or entitlement type is not merely ignored — it is
 * absent from the input type, so it cannot be plumbed through by accident.
 */

import { createHash } from "crypto";
import { pool } from "@/lib/db";
import type { PoolClient } from "pg";
import {
  managementProductRepository,
  managementPurchaseRepository,
  managementAccessPassRepository,
  managementUploadBundleRepository,
  managementJobRepository,
} from "@/repositories";
import { managementAuditService } from "@/services/management/ManagementAuditService";
import { ManagementJobKind } from "@/domain/enums/ManagementStatus";
import { computeAccessWindow } from "@/lib/management/calendarMath";
import { findManagementProduct } from "@/config/management";
import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";
import { isManagementProductCode } from "@/domain/enums/ManagementProductCode";
import type { ManagementProduct } from "@/domain/models/ManagementProduct";
import type { ManagementAccessPass } from "@/domain/models/ManagementEntitlement";
import type { ManagementUploadBundle } from "@/domain/models/ManagementUploadBundle";
import { ManagementPurchaseStatus } from "@/domain/models/ManagementPurchase";
import type { ManagementPurchase } from "@/domain/models/ManagementPurchase";

/** Thrown when the wallet cannot cover the price. Routes map this to HTTP 402. */
export class InsufficientCreditsError extends Error {
  constructor(
    readonly requiredCredits: number,
    readonly balanceCredits: number
  ) {
    super(
      `Insufficient credits. Required ${requiredCredits}, available ${balanceCredits}.`
    );
    this.name = "InsufficientCreditsError";
  }
}

export interface PurchaseResult {
  purchase: ManagementPurchase;
  accessPass: ManagementAccessPass | null;
  /** The upload-token bundle granted by the entry product, when that is what
   * was bought. Null for an access-pass purchase. */
  uploadBundle: ManagementUploadBundle | null;
  /** False when this call replayed an already-completed purchase. */
  charged: boolean;
  balanceCredits: number;
}

export class ManagementPurchaseService {
  constructor(
    private db = pool,
    private products = managementProductRepository,
    private purchases = managementPurchaseRepository,
    private passes = managementAccessPassRepository,
    private bundles = managementUploadBundleRepository,
    private jobs = managementJobRepository,
    private audit = managementAuditService
  ) {}

  /**
   * Idempotency key for a purchase.
   *
   * Every RClipper Management product is now legitimately repeatable — an access
   * pass may be bought twice to stack time, and an upload bundle is bought again
   * once its tokens run out. So the key includes a caller-supplied request token
   * that the client holds for the lifetime of ONE checkout: a double-click or a
   * refresh mid-purchase collapses to a single debit, while a deliberate second
   * purchase (new token) is correctly treated as new.
   *
   * The legacy `managementContentId` leg is retained only for compatibility with
   * any historical per-content purchase rows; new purchases pass it as null.
   */
  static idempotencyKey(params: {
    userId: string;
    productCode: ManagementProductCode;
    managementContentId: string | null;
    requestToken?: string | null;
  }): string {
    const material = [
      params.userId,
      params.productCode,
      params.managementContentId ?? "-",
      params.managementContentId ? "-" : (params.requestToken ?? "-"),
    ].join("|");
    return createHash("sha256").update(material).digest("hex");
  }

  /** Resolve a product code to its trusted database definition. */
  async resolveProduct(code: string): Promise<ManagementProduct> {
    if (!isManagementProductCode(code)) {
      throw new Error("Unknown Channel Management product.");
    }
    const fromDb = await this.products.findByCode(code);
    if (fromDb) return fromDb;

    // The config constant exists only so a missing row is a clear operational
    // error rather than a mystery. It is never used as a price.
    if (!findManagementProduct(code)) {
      throw new Error("Unknown Channel Management product.");
    }
    throw new Error(
      `Channel Management product "${code}" is not configured in the database. Apply migration 019.`
    );
  }

  /**
   * Buy publishing rights with credits.
   *
   * The debit and the entitlement activation happen in ONE database transaction,
   * so a crash can never leave a user charged without rights or granted rights
   * without a charge. There is consequently no "paid but unfulfilled" state to
   * recover from.
   *
   * Concurrency: the wallet row is locked FOR UPDATE at the start. Because a
   * user has exactly one wallet, that lock serialises all of that user's
   * Management purchases — which is what makes the "extend from current expiry"
   * calculation safe. Two passes bought simultaneously stack rather than both
   * reading the same starting expiry.
   */
  async purchase(params: {
    userId: string;
    productCode: string;
    /** Retained for compatibility; new purchases (bundle or pass) pass null. */
    managementContentId?: string | null;
    /** Client-held token that collapses a refreshed checkout to one debit. */
    requestToken?: string | null;
    now?: Date;
  }): Promise<PurchaseResult> {
    const now = params.now ?? new Date();
    const product = await this.resolveProduct(params.productCode);

    // The entry product ("single_video") is a consumable upload-token BUNDLE,
    // not a per-content unlock, so it is no longer tied to a content id.
    const isBundle = product.productType === "single_video";
    const managementContentId = null;

    if (isBundle) {
      if (!product.uploadAllowance || !product.accessWindowDays) {
        throw new Error(
          "Entry bundle product has no upload allowance / window configured. Apply migration 020."
        );
      }
    } else if (!product.durationMonths) {
      throw new Error("Access pass product has no duration configured.");
    }

    const idempotencyKey = ManagementPurchaseService.idempotencyKey({
      userId: params.userId,
      productCode: product.code,
      managementContentId,
      requestToken: params.requestToken ?? null,
    });

    const { purchase, created } = await this.purchases.createOrGetByIdempotencyKey({
      userId: params.userId,
      managementProductId: product.id,
      productCode: product.code,
      managementContentId,
      amountCredits: product.priceCredits,
      idempotencyKey,
    });

    // Replay of a purchase that already went through: return the existing
    // entitlement without touching the wallet. This is the path a refreshed page
    // or a double-clicked button lands on.
    if (!created && purchase.status !== ManagementPurchaseStatus.Pending) {
      const [accessPass, uploadBundle, balance] = await Promise.all([
        this.passes.findByPurchaseId(purchase.id),
        this.bundles.findByPurchaseId(purchase.id),
        this.readBalance(params.userId),
      ]);
      return {
        purchase,
        accessPass,
        uploadBundle,
        charged: false,
        balanceCredits: balance,
      };
    }

    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");

      // Lock the wallet. This both makes the balance check and the debit atomic,
      // and serialises this user's concurrent pass purchases.
      const walletResult = await client.query<{ id: string; balance: number }>(
        `SELECT id, balance FROM credit_wallets WHERE user_id = $1 FOR UPDATE`,
        [params.userId]
      );
      const wallet = walletResult.rows[0];
      const balance = wallet ? Number(wallet.balance) : 0;

      if (!wallet || balance < product.priceCredits) {
        await client.query("ROLLBACK");
        await this.purchases.updateStatus(purchase.id, ManagementPurchaseStatus.Failed, {
          failureReason: "insufficient_credits",
        });
        await this.audit.record("management.payment.failed", {
          userId: params.userId,
          purchaseId: purchase.id,
          managementContentId,
          metadata: {
            productCode: product.code,
            requiredCredits: product.priceCredits,
            balanceCredits: balance,
          },
        });
        throw new InsufficientCreditsError(product.priceCredits, balance);
      }

      // Conditional debit. Even with the row locked, the `balance >= $1`
      // predicate keeps this correct if the locking strategy ever changes.
      const debited = await client.query<{ balance: number }>(
        `UPDATE credit_wallets
            SET balance = balance - $1, updated_at = NOW()
          WHERE id = $2 AND balance >= $1
        RETURNING balance`,
        [product.priceCredits, wallet.id]
      );
      if (!debited.rows[0]) {
        await client.query("ROLLBACK");
        throw new InsufficientCreditsError(product.priceCredits, balance);
      }
      const newBalance = Number(debited.rows[0].balance);

      // Immutable ledger entry — the financial source of truth.
      const ledger = await client.query<{ id: string }>(
        `INSERT INTO credit_transactions
           (user_id, amount, type, description, reference_id)
         VALUES ($1, $2, 'management_purchase', $3, NULL)
         RETURNING id`,
        [
          params.userId,
          -product.priceCredits,
          `Channel Management: ${product.name} (${product.priceCredits} credits, one-time)`,
        ]
      );
      const creditTransactionId = ledger.rows[0].id;

      if (isBundle) {
        // Grant the upload-token bundle in the SAME transaction as the debit.
        // total_allowance == remaining at grant; expires_at = now + window days.
        const expiresAt = new Date(
          now.getTime() + product.accessWindowDays! * 86_400_000
        );
        const insertedBundle = await client.query(
          `INSERT INTO management_upload_bundles
             (user_id, management_product_id, product_code, purchase_id,
              credit_transaction_id, total_allowance, remaining, starts_at,
              expires_at, status)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'active')
           ON CONFLICT (purchase_id) DO NOTHING
           RETURNING id`,
          [
            params.userId,
            product.id,
            product.code,
            purchase.id,
            creditTransactionId,
            product.uploadAllowance!,
            now,
            expiresAt,
          ]
        );
        if (!insertedBundle.rows[0]) {
          // Another request already activated this exact purchase. Undo the
          // duplicate debit rather than granting a second allowance.
          await client.query("ROLLBACK");
          const existingBundle = await this.bundles.findByPurchaseId(purchase.id);
          return {
            purchase,
            accessPass: null,
            uploadBundle: existingBundle,
            charged: false,
            balanceCredits: balance,
          };
        }
      } else {
        // Re-read the effective expiry INSIDE the lock so two simultaneous pass
        // purchases stack instead of both starting from the same instant.
        const current = await client.query<{ expires_at: string }>(
          `SELECT expires_at
             FROM management_access_passes
            WHERE user_id = $1 AND status = 'active' AND revoked_at IS NULL
            ORDER BY expires_at DESC
            LIMIT 1`,
          [params.userId]
        );
        const currentExpiresAt = current.rows[0]
          ? new Date(current.rows[0].expires_at)
          : null;

        const { startsAt, expiresAt } = computeAccessWindow({
          now,
          currentExpiresAt,
          durationMonths: product.durationMonths!,
        });

        const insertedPass = await client.query(
          `INSERT INTO management_access_passes
             (user_id, management_product_id, product_code, purchase_id,
              credit_transaction_id, status, starts_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,'active',$6,$7)
           ON CONFLICT (purchase_id) DO NOTHING
           RETURNING id`,
          [
            params.userId,
            product.id,
            product.code,
            purchase.id,
            creditTransactionId,
            startsAt,
            expiresAt,
          ]
        );
        if (!insertedPass.rows[0]) {
          // Another request already activated this exact purchase. Undo the
          // duplicate debit rather than granting a second window.
          await client.query("ROLLBACK");
          const existingPass = await this.passes.findByPurchaseId(purchase.id);
          return {
            purchase,
            accessPass: existingPass,
            uploadBundle: null,
            charged: false,
            balanceCredits: balance,
          };
        }
      }

      await client.query(
        `UPDATE management_purchases
            SET status = 'paid',
                credit_transaction_id = $2,
                paid_at = NOW(),
                failure_reason = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [purchase.id, creditTransactionId]
      );

      await client.query("COMMIT");

      // Re-read through the repositories so callers get fully mapped models.
      const [finalPurchase, accessPass, uploadBundle] = await Promise.all([
        this.purchases.findById(purchase.id),
        this.passes.findByPurchaseId(purchase.id),
        this.bundles.findByPurchaseId(purchase.id),
      ]);

      await this.audit.record("management.payment.verified", {
        userId: params.userId,
        purchaseId: purchase.id,
        managementContentId,
        metadata: {
          productCode: product.code,
          amountCredits: product.priceCredits,
          rail: "credit_wallet",
        },
      });

      if (accessPass) {
        // "extended" when the window began in the future (stacked onto remaining
        // paid time), "activated" when it started now.
        const extended = accessPass.startsAt.getTime() > now.getTime() + 1000;
        await this.audit.record(
          extended ? "management.access.extended" : "management.access.activated",
          {
            userId: params.userId,
            purchaseId: purchase.id,
            accessPassId: accessPass.id,
            metadata: {
              productCode: product.code,
              startsAt: accessPass.startsAt.toISOString(),
              expiresAt: accessPass.expiresAt.toISOString(),
              autoRenew: false,
            },
          }
        );
      }
      if (uploadBundle) {
        await this.audit.record("management.upload_bundle.granted", {
          userId: params.userId,
          purchaseId: purchase.id,
          metadata: {
            productCode: product.code,
            totalAllowance: uploadBundle.totalAllowance,
            expiresAt: uploadBundle.expiresAt.toISOString(),
            autoRenew: false,
          },
        });
      }

      // Every management purchase extends the buyer's uploaded videos from the
      // free 7-day storage window to the paid 30-day one (only files still in the
      // free prefix are promoted). Done ASYNCHRONOUSLY so the S3 copies never
      // delay checkout, and swallowed on failure so it can never fail a purchase.
      try {
        await this.jobs.enqueue({
          kind: ManagementJobKind.ExtendUploadRetention,
          dedupeKey: `extend_uploads:${purchase.id}`,
          payload: { userId: params.userId },
          runAfter: now,
        });
      } catch (err) {
        console.error(
          "[management purchase] failed to enqueue upload-retention extension",
          err
        );
      }

      return {
        purchase: finalPurchase ?? purchase,
        accessPass,
        uploadBundle,
        charged: true,
        balanceCredits: newBalance,
      };
    } catch (err) {
      // A rollback on an already-finished transaction is harmless; swallow it so
      // the original error is what surfaces.
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async readBalance(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ balance: number }>(
      "SELECT balance FROM credit_wallets WHERE user_id = $1",
      [userId]
    );
    return rows[0] ? Number(rows[0].balance) : 0;
  }
}

export const managementPurchaseService = new ManagementPurchaseService();

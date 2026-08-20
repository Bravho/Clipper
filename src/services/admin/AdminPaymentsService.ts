import { pool } from "@/lib/db";
import { CREDITS_CONFIG } from "@/config/credits";
import { REPORTING_TIMEZONE, toBangkokDateInput, type DateRange } from "@/features/admin/dateRange";

/**
 * AdminPaymentsService — the revenue picture across BOTH product lines.
 *
 * ── The one distinction that governs this whole file ────────────────────────
 * `payment_intents.amount_baht` is the ONLY column in this database that holds
 * real money. Everything else is credits. Credits are worth ฿1 apiece
 * (`CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE`), so they can be *expressed* in baht,
 * but a credit balance is a liability the business already sold, not cash it
 * received again when the credit is spent. Adding the two together
 * double-counts every top-up.
 *
 * Worse, `mobile_store_purchases` has no price and no currency column at all —
 * Apple and Google keep the money and the receipt, and only the credit grant
 * reaches us. Its baht figure is therefore *imputed at the list rate*, ignores
 * store commission, and is wrong by construction for any promotional or
 * regional price. It is reported separately and flagged on screen, never
 * folded into a cash total.
 *
 * Every figure this service returns is tagged in its own field name or in the
 * page copy beside it as cash, credits, or imputed. Do not add a total that
 * mixes them.
 *
 * ── Timezone ───────────────────────────────────────────────────────────────
 * All timestamps are TIMESTAMPTZ (UTC). The business runs in Asia/Bangkok, so
 * every daily bucket applies `AT TIME ZONE REPORTING_TIMEZONE` — a 7am Bangkok
 * PromptPay scan otherwise books to the previous day's revenue.
 *
 * ── Why the pool directly and not a repository ─────────────────────────────
 * These are cross-table aggregates that belong to no single entity; a
 * repository per table would force the joins back into JS. Matches the
 * approach `LoginEventService` / `GateEventService` already take.
 */

/**
 * The slice of `pg`'s Pool this service uses, so tests can pass a stub instead
 * of constructing a real Pool (which would try to open a socket).
 */
interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// ─── Row helpers ─────────────────────────────────────────────────────────────
// `pg` hands back COUNT(*) as a string and every NUMERIC as a string, because
// int8/numeric do not fit JS numbers losslessly. Left alone they CONCATENATE:
// "120" + "50" is "12050" baht of revenue that never existed. Counts are cast
// `::int` in SQL; money is parsed here. Precedent:
// `PostgresClipRequestRepository.countByStatus()`.

/** NUMERIC / float8 column → number. Tolerates null, undefined and strings. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `::int`-cast column → number. Same tolerance, integer semantics. */
function int(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

/**
 * TIMESTAMPTZ → ISO 8601 (UTC).
 *
 * `pg` hands TIMESTAMPTZ back as a JS `Date`, whose default `toString()` is a
 * locale-flavoured "Sat Aug 16 2026 ..." that neither sorts nor parses. ISO
 * does both, which is what makes the export sortable as plain text.
 */
function iso(value: unknown): string {
  if (value === null || value === undefined) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** Percentage guarded against a zero denominator (returns 0, never NaN). */
function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

// ─── Result shapes ───────────────────────────────────────────────────────────

/** One day on the revenue chart. Both figures are baht, but only one is cash. */
export interface RevenueDayPoint {
  /** `YYYY-MM-DD` in Bangkok. */
  date: string;
  /** Real cash settled through the gateway. */
  videoGenerationBaht: number;
  /** Credits spent on Channel Management, valued at ฿1. NOT cash. */
  channelManagementBaht: number;
  [key: string]: string | number;
}

export interface TopUpFunnel {
  created: number;
  paid: number;
  pending: number;
  expired: number;
  failed: number;
  /** paid ÷ created, as a percentage. */
  conversionPct: number;
  /** Cash settled from intents created in the window. */
  paidBaht: number;
  /** Baht the funnel dropped: intents that expired or failed. */
  abandonedBaht: number;
  /**
   * `updated_at - created_at` for paid rows. There is no `paid_at` column, so
   * this is only as accurate as "the paid webhook was the last write" — true
   * today, and null when nothing settled in the window.
   */
  medianSecondsToPay: number | null;
}

export interface GatewayMethodRow {
  gateway: string;
  method: string;
  attempts: number;
  paid: number;
  paidBaht: number;
  conversionPct: number;
}

export interface CreditTypeRow {
  type: string;
  count: number;
  /** Signed, as stored: negative for debits. */
  credits: number;
}

export interface MobileStoreRow {
  platform: string;
  purchases: number;
  creditsGranted: number;
  /** credits × ฿1. Imputed — the store price is not in this database. */
  impliedBaht: number;
}

export interface ProductRevenueRow {
  productCode: string;
  productName: string;
  paidCount: number;
  paidCredits: number;
  refundedCount: number;
  refundedCredits: number;
  failedCount: number;
  pendingCount: number;
  totalCount: number;
  /** refunded ÷ (paid + refunded) purchases, as a percentage. */
  refundRatePct: number;
}

export interface FailureReasonRow {
  reason: string;
  count: number;
}

export interface UploadBundleBurn {
  bundles: number;
  totalAllowance: number;
  remaining: number;
  /** Tokens actually spent: `total_allowance - remaining`. */
  burned: number;
  burnPct: number;
  /** Bundles that ran out of time with tokens left — a refund-risk signal. */
  expiredUnusedBundles: number;
  /** Tokens stranded in those bundles: sold, paid for, never delivered. */
  expiredUnusedTokens: number;
}

/**
 * `credit_purchase_logs` has NO migration anywhere in this repo — only a
 * repository that queries it. It may simply not exist in a given environment,
 * so the section reports its own availability instead of throwing.
 */
export interface CreditPurchaseLogSummary {
  available: boolean;
  entries: number;
  creditsAdded: number;
  amountBaht: number;
}

/** Which side of the business a money event belongs to. */
export type RevenueLine = "video_generation" | "channel_management";

/**
 * What the amount on a row actually IS. The single most important column in
 * the export — `THB_CASH` is money received, `CREDITS` is a wallet movement,
 * `CREDITS_IMPUTED` is a guess at money Apple or Google received.
 */
export type MoneyUnit = "THB_CASH" | "CREDITS" | "CREDITS_IMPUTED";

/** One row of the CSV export. */
export interface MoneyEventRow {
  /** ISO 8601, UTC. */
  occurredAt: string;
  source:
    | "payment_intent"
    | "management_purchase"
    | "mobile_store_purchase"
    | "credit_transaction"
    | "credit_purchase_log";
  line: RevenueLine;
  unit: MoneyUnit;
  userId: string;
  userEmail: string;
  /** Row-native status: intent status, purchase status, or ledger type. */
  status: string;
  amountBaht: number;
  amountCredits: number;
  productCode: string;
  /** Gateway/method, store platform, or `credit_wallet`. */
  channel: string;
  reference: string;
  description: string;
}

/**
 * Per-source row cap for the export. A 730-day window over a busy ledger would
 * otherwise be assembled into one string in memory before the response starts.
 */
export const MAX_EXPORT_ROWS_PER_SOURCE = 50_000;

/** Ledger types belonging to Channel Management rather than video generation. */
const MANAGEMENT_LEDGER_TYPES = new Set(["management_purchase", "management_refund"]);

export interface AdminPaymentsSummary {
  range: { fromInput: string; toInput: string; days: number };

  headline: {
    /** payment_intents, status = paid. The only true cash figure on the page. */
    cashBaht: number;
    /** Net credits consumed on products (charges less refunds). */
    creditsSpentNet: number;
    /** Distinct users with at least one settled CASH top-up. */
    payingUsers: number;
    /** cashBaht ÷ payingUsers. Cash only — credit-funded spend is excluded. */
    arpuBaht: number;
  };

  revenueSeries: RevenueDayPoint[];

  videoGeneration: {
    funnel: TopUpFunnel;
    byGatewayMethod: GatewayMethodRow[];
    creditsCharged: number;
    creditsRefunded: number;
    creditsNet: number;
    chargeCount: number;
    refundCount: number;
    downloads: {
      requests: number;
      unlocked: number;
      trial: number;
      unlockedPct: number;
    };
    mobileStore: MobileStoreRow[];
    mobileStoreTotals: { purchases: number; creditsGranted: number; impliedBaht: number };
    /** Legacy per-request baht columns. Zero under the credit model. */
    requestPricing: {
      priceBaht: number;
      discountBaht: number;
      amountPaidBaht: number;
      pricedRequests: number;
    };
    purchaseLog: CreditPurchaseLogSummary;
  };

  channelManagement: {
    byProduct: ProductRevenueRow[];
    totals: {
      paidCount: number;
      paidCredits: number;
      refundedCount: number;
      refundedCredits: number;
      refundRatePct: number;
    };
    failures: FailureReasonRow[];
    passes: { active: number; expiringIn30Days: number };
    bundles: UploadBundleBurn;
  };

  /** Point-in-time, not range-bounded: what the business currently owes. */
  creditFloat: { totalCredits: number; liabilityBaht: number; wallets: number };

  creditTypes: CreditTypeRow[];
}

// Credit spend that represents a PRODUCT sale, split by product line. Admin
// grants and signup bonuses are deliberately excluded: they are marketing cost,
// not revenue, and folding them in makes every conversion rate look better than
// it is.
const VIDEO_SPEND_TYPES = ["request_charge"] as const;
const VIDEO_REFUND_TYPES = ["request_refund"] as const;
const MANAGEMENT_SPEND_TYPES = ["management_purchase"] as const;
const MANAGEMENT_REFUND_TYPES = ["management_refund"] as const;

export class AdminPaymentsService {
  constructor(private db: QueryableDb = pool) {}

  /**
   * Everything the `/admin/payments` page renders, in one pass.
   *
   * The queries are independent, so they run concurrently — the page is a
   * server component and its time-to-first-byte is the sum of whatever it
   * awaits serially.
   */
  async getSummary(range: DateRange): Promise<AdminPaymentsSummary> {
    const bounds = [range.from, range.to];

    const [
      funnelRows,
      medianRow,
      gatewayRows,
      cashSeriesRows,
      payingUserRow,
      creditTypeRows,
      mgmtSeriesRows,
      downloadRow,
      mobileRows,
      pricingRow,
      productRows,
      failureRows,
      passRow,
      bundleRow,
      floatRow,
      purchaseLog,
    ] = await Promise.all([
      this.queryTopUpFunnel(bounds),
      this.queryMedianTimeToPay(bounds),
      this.queryGatewayMethod(bounds),
      this.queryCashSeries(bounds),
      this.queryPayingUsers(bounds),
      this.queryCreditTypes(bounds),
      this.queryManagementSeries(bounds),
      this.queryDownloadGate(bounds),
      this.queryMobileStore(bounds),
      this.queryRequestPricing(bounds),
      this.queryProductRevenue(bounds),
      this.queryFailureReasons(bounds),
      this.queryAccessPasses(),
      this.queryUploadBundles(bounds),
      this.queryCreditFloat(),
      this.queryCreditPurchaseLog(bounds),
    ]);

    const funnel = buildFunnel(funnelRows, num(medianRow?.median_seconds ?? null), medianRow);
    const revenueSeries = buildRevenueSeries(range, cashSeriesRows, mgmtSeriesRows);

    const creditTypes: CreditTypeRow[] = creditTypeRows.map((row) => ({
      type: str(row.type, "unknown"),
      count: int(row.count),
      credits: int(row.credits),
    }));
    const creditsBy = (types: readonly string[]) =>
      creditTypes
        .filter((row) => types.includes(row.type))
        .reduce((acc, row) => ({ credits: acc.credits + row.credits, count: acc.count + row.count }), {
          credits: 0,
          count: 0,
        });

    // Debits are stored negative; report them as positive magnitudes.
    const videoCharged = creditsBy(VIDEO_SPEND_TYPES);
    const videoRefunded = creditsBy(VIDEO_REFUND_TYPES);
    const mgmtCharged = creditsBy(MANAGEMENT_SPEND_TYPES);
    const mgmtRefunded = creditsBy(MANAGEMENT_REFUND_TYPES);

    const creditsCharged = Math.abs(videoCharged.credits);
    const creditsRefunded = Math.abs(videoRefunded.credits);
    const creditsSpentNet =
      Math.abs(videoCharged.credits) +
      Math.abs(mgmtCharged.credits) -
      Math.abs(videoRefunded.credits) -
      Math.abs(mgmtRefunded.credits);

    const cashBaht = funnel.paidBaht;
    const payingUsers = int(payingUserRow?.paying_users);

    const byGatewayMethod: GatewayMethodRow[] = gatewayRows.map((row) => {
      const attempts = int(row.attempts);
      const paid = int(row.paid);
      return {
        gateway: str(row.gateway, "unknown"),
        method: str(row.method, "unknown"),
        attempts,
        paid,
        paidBaht: num(row.paid_baht),
        conversionPct: pct(paid, attempts),
      };
    });

    const mobileStore: MobileStoreRow[] = mobileRows.map((row) => {
      const credits = int(row.credits_granted);
      return {
        platform: str(row.platform, "unknown"),
        purchases: int(row.purchases),
        creditsGranted: credits,
        impliedBaht: credits * CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE,
      };
    });
    const mobileStoreTotals = mobileStore.reduce(
      (acc, row) => ({
        purchases: acc.purchases + row.purchases,
        creditsGranted: acc.creditsGranted + row.creditsGranted,
        impliedBaht: acc.impliedBaht + row.impliedBaht,
      }),
      { purchases: 0, creditsGranted: 0, impliedBaht: 0 }
    );

    const byProduct: ProductRevenueRow[] = productRows.map((row) => {
      const paidCount = int(row.paid_count);
      const refundedCount = int(row.refunded_count);
      return {
        productCode: str(row.product_code, "unknown"),
        productName: str(row.product_name) || str(row.product_code, "unknown"),
        paidCount,
        paidCredits: int(row.paid_credits),
        refundedCount,
        refundedCredits: int(row.refunded_credits),
        failedCount: int(row.failed_count),
        pendingCount: int(row.pending_count),
        totalCount: int(row.total_count),
        refundRatePct: pct(refundedCount, paidCount + refundedCount),
      };
    });
    const productTotals = byProduct.reduce(
      (acc, row) => ({
        paidCount: acc.paidCount + row.paidCount,
        paidCredits: acc.paidCredits + row.paidCredits,
        refundedCount: acc.refundedCount + row.refundedCount,
        refundedCredits: acc.refundedCredits + row.refundedCredits,
      }),
      { paidCount: 0, paidCredits: 0, refundedCount: 0, refundedCredits: 0 }
    );

    const totalAllowance = int(bundleRow?.total_allowance);
    const remaining = int(bundleRow?.remaining);
    const burned = totalAllowance - remaining;

    const requests = int(downloadRow?.requests);
    const unlocked = int(downloadRow?.unlocked);

    const floatCredits = int(floatRow?.total_credits);

    return {
      range: { fromInput: range.fromInput, toInput: range.toInput, days: range.days },

      headline: {
        cashBaht,
        creditsSpentNet,
        payingUsers,
        arpuBaht: payingUsers > 0 ? cashBaht / payingUsers : 0,
      },

      revenueSeries,

      videoGeneration: {
        funnel,
        byGatewayMethod,
        creditsCharged,
        creditsRefunded,
        creditsNet: creditsCharged - creditsRefunded,
        chargeCount: videoCharged.count,
        refundCount: videoRefunded.count,
        downloads: {
          requests,
          unlocked,
          trial: int(downloadRow?.trial),
          unlockedPct: pct(unlocked, requests),
        },
        mobileStore,
        mobileStoreTotals,
        requestPricing: {
          priceBaht: num(pricingRow?.price_baht),
          discountBaht: num(pricingRow?.discount_baht),
          amountPaidBaht: num(pricingRow?.amount_paid_baht),
          pricedRequests: int(pricingRow?.priced_requests),
        },
        purchaseLog,
      },

      channelManagement: {
        byProduct,
        totals: {
          ...productTotals,
          refundRatePct: pct(
            productTotals.refundedCount,
            productTotals.paidCount + productTotals.refundedCount
          ),
        },
        failures: failureRows.map((row) => ({
          reason: str(row.reason, "(unspecified)"),
          count: int(row.count),
        })),
        passes: {
          active: int(passRow?.active),
          expiringIn30Days: int(passRow?.expiring_soon),
        },
        bundles: {
          bundles: int(bundleRow?.bundles),
          totalAllowance,
          remaining,
          burned,
          burnPct: pct(burned, totalAllowance),
          expiredUnusedBundles: int(bundleRow?.expired_unused_bundles),
          expiredUnusedTokens: int(bundleRow?.expired_unused_tokens),
        },
      },

      creditFloat: {
        totalCredits: floatCredits,
        liabilityBaht: floatCredits * CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE,
        wallets: int(floatRow?.wallets),
      },

      creditTypes,
    };
  }

  // ─── Video generation ──────────────────────────────────────────────────────

  /**
   * The top-up funnel, on a COHORT basis: intents *created* in the window,
   * whatever their eventual status.
   *
   * Created-at rather than settled-at is deliberate. A PromptPay QR is payable
   * for `PAYMENTS_CONFIG.intentTtlMinutes` (30 by default), so an intent and
   * its payment are almost always the same Bangkok day; and `created_at` is the
   * one timestamp no later reconciliation UPDATE can move, which `updated_at`
   * is not.
   */
  private async queryTopUpFunnel(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT status,
              COUNT(*)::int                       AS count,
              COALESCE(SUM(amount_baht), 0)       AS baht
         FROM payment_intents
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY status`,
      bounds
    );
    return rows;
  }

  /**
   * Median seconds from QR issued to settled.
   *
   * `payment_intents` has no `paid_at`, so the settle time is `updated_at` and
   * the measure inherits that column's caveat. Median rather than mean: one
   * user who left the tab open overnight would drag an average into nonsense.
   */
  private async queryMedianTimeToPay(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at))
              )::float8                            AS median_seconds,
              COUNT(*)::int                        AS paid_count
         FROM payment_intents
        WHERE status = 'paid'
          AND created_at >= $1 AND created_at < $2`,
      bounds
    );
    return rows[0];
  }

  private async queryGatewayMethod(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT gateway,
              method,
              COUNT(*)::int                                             AS attempts,
              COUNT(*) FILTER (WHERE status = 'paid')::int              AS paid,
              COALESCE(SUM(amount_baht) FILTER (WHERE status = 'paid'), 0) AS paid_baht
         FROM payment_intents
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY gateway, method
        ORDER BY paid_baht DESC, attempts DESC`,
      bounds
    );
    return rows;
  }

  /** Daily settled cash, bucketed by Bangkok day. */
  private async queryCashSeries(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT to_char(created_at AT TIME ZONE '${REPORTING_TIMEZONE}', 'YYYY-MM-DD') AS day,
              COALESCE(SUM(amount_baht), 0)                                          AS baht
         FROM payment_intents
        WHERE status = 'paid'
          AND created_at >= $1 AND created_at < $2
        GROUP BY 1
        ORDER BY 1`,
      bounds
    );
    return rows;
  }

  /**
   * Distinct users who settled real cash in the window.
   *
   * Soft-deleted users are excluded from the COUNT — this is a "how many
   * customers" figure, and a tombstoned account is not one. Their MONEY still
   * counts everywhere else in this file; only head-counts filter them out.
   */
  private async queryPayingUsers(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT COUNT(DISTINCT pi.user_id)::int AS paying_users
         FROM payment_intents pi
         JOIN users u ON u.id = pi.user_id
        WHERE pi.status = 'paid'
          AND pi.created_at >= $1 AND pi.created_at < $2
          AND u.deleted_at IS NULL`,
      bounds
    );
    return rows[0];
  }

  /** The whole credit ledger for the window, grouped by type. */
  private async queryCreditTypes(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT type,
              COUNT(*)::int              AS count,
              COALESCE(SUM(amount), 0)::int AS credits
         FROM credit_transactions
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY type
        ORDER BY type`,
      bounds
    );
    return rows;
  }

  /**
   * The pay-to-download gate.
   *
   * `clip_requests.download_unlocked` is a BOOLEAN with no accompanying
   * timestamp, so an unlock cannot be dated. This counts requests CREATED in
   * the window that are unlocked *as of now* — a request created in the window
   * and unlocked after it still counts, and one created earlier and unlocked
   * inside the window does not. It is a cohort rate, not an activity rate; the
   * page says so.
   */
  private async queryDownloadGate(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int                                        AS requests,
              COUNT(*) FILTER (WHERE download_unlocked)::int       AS unlocked,
              COUNT(*) FILTER (WHERE is_trial_request)::int        AS trial
         FROM clip_requests
        WHERE created_at >= $1 AND created_at < $2`,
      bounds
    );
    return rows[0];
  }

  /**
   * The per-request baht columns on `clip_requests`.
   *
   * `price_baht`, `discount_baht` and `amount_paid_baht` are NUMERIC(10,2) and
   * predate the credit model — requests are now charged a flat credit price at
   * submission (`CREDITS_CONFIG.REQUEST_COST_CREDITS`) and nothing writes these
   * columns, so they read 0 for every modern row. They are reported anyway,
   * with the priced-row count beside them: a non-zero count is the only signal
   * that some environment still populates them, and silently omitting the
   * columns would leave that money invisible.
   */
  private async queryRequestPricing(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT COALESCE(SUM(price_baht), 0)                       AS price_baht,
              COALESCE(SUM(discount_baht), 0)                    AS discount_baht,
              COALESCE(SUM(amount_paid_baht), 0)                 AS amount_paid_baht,
              COUNT(*) FILTER (
                WHERE price_baht <> 0 OR amount_paid_baht <> 0
              )::int                                             AS priced_requests
         FROM clip_requests
        WHERE created_at >= $1 AND created_at < $2`,
      bounds
    );
    return rows[0];
  }

  /**
   * Apple / Google purchases.
   *
   * `purchased_at` is nullable (the store receipt does not always carry one),
   * so `created_at` is the fallback — otherwise those rows silently vanish
   * from every window.
   */
  private async queryMobileStore(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT platform,
              COUNT(*)::int                          AS purchases,
              COALESCE(SUM(credits_granted), 0)::int AS credits_granted
         FROM mobile_store_purchases
        WHERE COALESCE(purchased_at, created_at) >= $1
          AND COALESCE(purchased_at, created_at) <  $2
        GROUP BY platform
        ORDER BY platform`,
      bounds
    );
    return rows;
  }

  /**
   * `credit_purchase_logs` summary, or an "unavailable" marker.
   *
   * The table has no DDL in this repo — `PostgresCreditPurchaseLogRepository`
   * is the only evidence it was ever meant to exist. Querying it blind would
   * fail the whole page with `relation does not exist`, so presence is probed
   * with `to_regclass` first (the guard style migration 024 established) and
   * the query is additionally wrapped: a permissions error or a column drift
   * should degrade one section, not the report.
   */
  private async queryCreditPurchaseLog(bounds: unknown[]): Promise<CreditPurchaseLogSummary> {
    const unavailable: CreditPurchaseLogSummary = {
      available: false,
      entries: 0,
      creditsAdded: 0,
      amountBaht: 0,
    };

    try {
      const probe = await this.db.query(
        "SELECT to_regclass('public.credit_purchase_logs') IS NOT NULL AS present"
      );
      if (probe.rows[0]?.present !== true) return unavailable;

      const { rows } = await this.db.query(
        `SELECT COUNT(*)::int                           AS entries,
                COALESCE(SUM(credits_added), 0)::int    AS credits_added,
                COALESCE(SUM(amount_baht), 0)           AS amount_baht
           FROM credit_purchase_logs
          WHERE created_at >= $1 AND created_at < $2`,
        bounds
      );
      const row = rows[0];
      return {
        available: true,
        entries: int(row?.entries),
        creditsAdded: int(row?.credits_added),
        amountBaht: num(row?.amount_baht),
      };
    } catch (err) {
      console.error("[adminPayments] credit_purchase_logs unavailable:", err);
      return unavailable;
    }
  }

  // ─── Channel Management ────────────────────────────────────────────────────

  /** Daily Channel Management credits, bucketed by Bangkok day. */
  private async queryManagementSeries(bounds: unknown[]) {
    // COALESCE(paid_at, created_at): `paid_at` is nullable and was populated
    // only once the paid transition started stamping it, so legacy paid rows
    // would otherwise fall out of every bucket.
    const { rows } = await this.db.query(
      `SELECT to_char(
                COALESCE(paid_at, created_at) AT TIME ZONE '${REPORTING_TIMEZONE}',
                'YYYY-MM-DD'
              )                                        AS day,
              COALESCE(SUM(amount_credits), 0)::int    AS credits
         FROM management_purchases
        WHERE status = 'paid'
          AND COALESCE(paid_at, created_at) >= $1
          AND COALESCE(paid_at, created_at) <  $2
        GROUP BY 1
        ORDER BY 1`,
      bounds
    );
    return rows;
  }

  /**
   * Purchases by product, on a cohort basis (created in the window).
   *
   * The refund columns therefore mean "of the purchases started in this window,
   * how many have since been refunded" — the number a pricing decision needs.
   * A refunds-that-happened-in-the-window figure would key off `refunded_at`
   * and answer a different question.
   *
   * Joined on `code`, not the product FK: `product_code` is denormalised onto
   * the purchase precisely so history survives a product row being edited or
   * retired, and the join is only for the display name.
   */
  private async queryProductRevenue(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT p.product_code,
              MAX(mp.name)                                                       AS product_name,
              COUNT(*) FILTER (WHERE p.status = 'paid')::int                     AS paid_count,
              COALESCE(SUM(p.amount_credits) FILTER (WHERE p.status = 'paid'), 0)::int
                                                                                 AS paid_credits,
              COUNT(*) FILTER (WHERE p.status = 'refunded')::int                 AS refunded_count,
              COALESCE(SUM(p.amount_credits) FILTER (WHERE p.status = 'refunded'), 0)::int
                                                                                 AS refunded_credits,
              COUNT(*) FILTER (WHERE p.status = 'failed')::int                   AS failed_count,
              COUNT(*) FILTER (WHERE p.status = 'pending')::int                  AS pending_count,
              COUNT(*)::int                                                      AS total_count
         FROM management_purchases p
         LEFT JOIN management_products mp ON mp.code = p.product_code
        WHERE p.created_at >= $1 AND p.created_at < $2
        GROUP BY p.product_code
        ORDER BY paid_credits DESC, total_count DESC`,
      bounds
    );
    return rows;
  }

  private async queryFailureReasons(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT COALESCE(NULLIF(failure_reason, ''), '(unspecified)') AS reason,
              COUNT(*)::int                                         AS count
         FROM management_purchases
        WHERE status = 'failed'
          AND created_at >= $1 AND created_at < $2
        GROUP BY 1
        ORDER BY count DESC, reason ASC`,
      bounds
    );
    return rows;
  }

  /**
   * Access passes — a POINT-IN-TIME reading, deliberately not range-bounded.
   *
   * "How many passes are live right now" and "which lapse within 30 days" are
   * questions about today; filtering them by the report window would answer
   * neither. The page labels them as current.
   */
  private async queryAccessPasses() {
    const { rows } = await this.db.query(
      `SELECT COUNT(*) FILTER (
                WHERE status = 'active' AND starts_at <= NOW() AND expires_at > NOW()
              )::int AS active,
              COUNT(*) FILTER (
                WHERE status = 'active'
                  AND expires_at >  NOW()
                  AND expires_at <= NOW() + INTERVAL '30 days'
              )::int AS expiring_soon
         FROM management_access_passes`
    );
    return rows[0];
  }

  /**
   * Upload-bundle burn: what the entry product actually delivered.
   *
   * `expired_unused_*` counts bundles whose window has lapsed with tokens left.
   * The status test is `IN ('active','expired')` rather than `= 'expired'`
   * because nothing sweeps the status synchronously — a bundle past
   * `expires_at` is unspendable regardless of what the column still says, and
   * counting only swept rows would understate the problem. Refunded and revoked
   * bundles are excluded: their tokens were not stranded, they were returned.
   */
  private async queryUploadBundles(bounds: unknown[]) {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int                              AS bundles,
              COALESCE(SUM(total_allowance), 0)::int     AS total_allowance,
              COALESCE(SUM(remaining), 0)::int           AS remaining,
              COUNT(*) FILTER (
                WHERE remaining > 0
                  AND expires_at < NOW()
                  AND status IN ('active', 'expired')
              )::int                                     AS expired_unused_bundles,
              COALESCE(SUM(remaining) FILTER (
                WHERE remaining > 0
                  AND expires_at < NOW()
                  AND status IN ('active', 'expired')
              ), 0)::int                                 AS expired_unused_tokens
         FROM management_upload_bundles
        WHERE created_at >= $1 AND created_at < $2`,
      bounds
    );
    return rows[0];
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  /**
   * Every money event in the window, both product lines, one row apiece.
   *
   * The five sources overlap ECONOMICALLY on purpose and must not be summed
   * blindly: a Channel Management sale appears once as a `management_purchase`
   * and again as the `credit_transaction` that debited the wallet. The `source`
   * and `unit` columns are what make the file safe to pivot — filter to one
   * source before totalling anything.
   *
   * Ordered by time so the file reads as a statement. Each source is capped
   * independently; a two-year export of a busy ledger would otherwise buffer
   * the whole table into memory to build one string.
   */
  async getMoneyEvents(range: DateRange): Promise<MoneyEventRow[]> {
    const bounds: unknown[] = [range.from, range.to, MAX_EXPORT_ROWS_PER_SOURCE];

    // No `users.deleted_at` filter anywhere below: this is the money record,
    // and money does not disappear because an account was later closed. The
    // email column simply reads as the anonymised tombstone for those rows.
    const [intents, purchases, mobile, ledger, logs] = await Promise.all([
      this.db.query(
        `SELECT pi.created_at                     AS occurred_at,
                pi.user_id,
                u.email,
                pi.status,
                pi.amount_baht,
                pi.credits_to_add,
                pi.gateway,
                pi.method,
                pi.reference_no,
                pi.updated_at
           FROM payment_intents pi
           LEFT JOIN users u ON u.id = pi.user_id
          WHERE pi.created_at >= $1 AND pi.created_at < $2
          ORDER BY pi.created_at
          LIMIT $3`,
        bounds
      ),
      this.db.query(
        `SELECT COALESCE(p.paid_at, p.created_at) AS occurred_at,
                p.user_id,
                u.email,
                p.status,
                p.amount_credits,
                p.product_code,
                p.idempotency_key,
                p.failure_reason
           FROM management_purchases p
           LEFT JOIN users u ON u.id = p.user_id
          WHERE COALESCE(p.paid_at, p.created_at) >= $1
            AND COALESCE(p.paid_at, p.created_at) <  $2
          ORDER BY 1
          LIMIT $3`,
        bounds
      ),
      this.db.query(
        `SELECT COALESCE(m.purchased_at, m.created_at) AS occurred_at,
                m.user_id,
                u.email,
                m.platform,
                m.product_id,
                m.transaction_id,
                m.credits_granted,
                m.store_environment
           FROM mobile_store_purchases m
           LEFT JOIN users u ON u.id = m.user_id
          WHERE COALESCE(m.purchased_at, m.created_at) >= $1
            AND COALESCE(m.purchased_at, m.created_at) <  $2
          ORDER BY 1
          LIMIT $3`,
        bounds
      ),
      this.db.query(
        `SELECT t.created_at AS occurred_at,
                t.user_id,
                u.email,
                t.type,
                t.amount,
                t.description,
                t.reference_id
           FROM credit_transactions t
           LEFT JOIN users u ON u.id = t.user_id
          WHERE t.created_at >= $1 AND t.created_at < $2
          ORDER BY t.created_at
          LIMIT $3`,
        bounds
      ),
      this.queryCreditPurchaseLogRows(bounds),
    ]);

    const rows: MoneyEventRow[] = [];

    for (const row of intents.rows) {
      rows.push({
        occurredAt: iso(row.occurred_at),
        source: "payment_intent",
        line: "video_generation",
        unit: "THB_CASH",
        userId: str(row.user_id),
        userEmail: str(row.email),
        status: str(row.status),
        amountBaht: num(row.amount_baht),
        amountCredits: int(row.credits_to_add),
        productCode: "",
        channel: `${str(row.gateway)} / ${str(row.method)}`,
        reference: str(row.reference_no),
        description: `Top-up of ${int(row.credits_to_add)} credits`,
      });
    }

    for (const row of purchases.rows) {
      rows.push({
        occurredAt: iso(row.occurred_at),
        source: "management_purchase",
        line: "channel_management",
        unit: "CREDITS",
        userId: str(row.user_id),
        userEmail: str(row.email),
        status: str(row.status),
        // Credits valued at ฿1 — a wallet debit, not a fresh cash receipt.
        amountBaht: int(row.amount_credits) * CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE,
        amountCredits: int(row.amount_credits),
        productCode: str(row.product_code),
        channel: "credit_wallet",
        reference: str(row.idempotency_key),
        description: str(row.failure_reason),
      });
    }

    for (const row of mobile.rows) {
      rows.push({
        occurredAt: iso(row.occurred_at),
        source: "mobile_store_purchase",
        line: "video_generation",
        // IMPUTED: the store keeps the price. See the header note in the file.
        unit: "CREDITS_IMPUTED",
        userId: str(row.user_id),
        userEmail: str(row.email),
        status: "granted",
        amountBaht: int(row.credits_granted) * CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE,
        amountCredits: int(row.credits_granted),
        productCode: str(row.product_id),
        channel: str(row.platform),
        reference: str(row.transaction_id),
        description: `store_environment=${str(row.store_environment)}`,
      });
    }

    for (const row of ledger.rows) {
      rows.push({
        occurredAt: iso(row.occurred_at),
        source: "credit_transaction",
        line: MANAGEMENT_LEDGER_TYPES.has(str(row.type))
          ? "channel_management"
          : "video_generation",
        unit: "CREDITS",
        userId: str(row.user_id),
        userEmail: str(row.email),
        status: str(row.type),
        amountBaht: int(row.amount) * CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE,
        amountCredits: int(row.amount),
        productCode: "",
        channel: "credit_wallet",
        reference: str(row.reference_id),
        description: str(row.description),
      });
    }

    for (const row of logs) {
      rows.push({
        occurredAt: iso(row.occurred_at),
        source: "credit_purchase_log",
        line: "video_generation",
        unit: "THB_CASH",
        userId: str(row.user_id),
        userEmail: str(row.email),
        status: "logged",
        amountBaht: num(row.amount_baht),
        amountCredits: int(row.credits_added),
        productCode: "",
        channel: "legacy_log",
        reference: str(row.transaction_ref),
        description: "",
      });
    }

    rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    return rows;
  }

  /** `credit_purchase_logs` detail rows, or nothing if the table is absent. */
  private async queryCreditPurchaseLogRows(
    bounds: unknown[]
  ): Promise<Record<string, unknown>[]> {
    try {
      const probe = await this.db.query(
        "SELECT to_regclass('public.credit_purchase_logs') IS NOT NULL AS present"
      );
      if (probe.rows[0]?.present !== true) return [];

      const { rows } = await this.db.query(
        `SELECT l.created_at AS occurred_at,
                l.user_id,
                u.email,
                l.credits_added,
                l.amount_baht,
                l.transaction_ref
           FROM credit_purchase_logs l
           LEFT JOIN users u ON u.id = l.user_id
          WHERE l.created_at >= $1 AND l.created_at < $2
          ORDER BY l.created_at
          LIMIT $3`,
        bounds
      );
      return rows;
    } catch (err) {
      console.error("[adminPayments] credit_purchase_logs export skipped:", err);
      return [];
    }
  }

  // ─── Float ─────────────────────────────────────────────────────────────────

  /**
   * Outstanding credit float — money already taken for goods not yet delivered.
   *
   * Live wallets only: account deletion anonymises the row in place, and a
   * tombstoned balance is not a liability anyone can redeem.
   */
  private async queryCreditFloat() {
    const { rows } = await this.db.query(
      `SELECT COALESCE(SUM(w.balance), 0)::int AS total_credits,
              COUNT(*)::int                    AS wallets
         FROM credit_wallets w
         JOIN users u ON u.id = w.user_id
        WHERE u.deleted_at IS NULL`
    );
    return rows[0];
  }
}

// ─── Pure shaping helpers (exported for tests) ───────────────────────────────

/** Fold the per-status funnel rows into the funnel shape. */
export function buildFunnel(
  rows: Record<string, unknown>[],
  medianSeconds: number,
  medianRow?: Record<string, unknown>
): TopUpFunnel {
  const byStatus = new Map<string, { count: number; baht: number }>();
  for (const row of rows) {
    byStatus.set(str(row.status, "unknown"), {
      count: int(row.count),
      baht: num(row.baht),
    });
  }
  const get = (status: string) => byStatus.get(status) ?? { count: 0, baht: 0 };

  const paid = get("paid");
  const pending = get("pending");
  const expired = get("expired");
  const failed = get("failed");
  const created = [...byStatus.values()].reduce((sum, s) => sum + s.count, 0);

  // Median is only meaningful when something settled; percentile_cont over an
  // empty set returns NULL, which `num()` would flatten to a misleading 0.
  const paidCount = medianRow ? int(medianRow.paid_count) : paid.count;

  return {
    created,
    paid: paid.count,
    pending: pending.count,
    expired: expired.count,
    failed: failed.count,
    conversionPct: pct(paid.count, created),
    paidBaht: paid.baht,
    abandonedBaht: expired.baht + failed.baht,
    medianSecondsToPay: paidCount > 0 ? medianSeconds : null,
  };
}

/**
 * Zip the two daily aggregates onto a complete Bangkok-day spine.
 *
 * The spine is generated here rather than with `generate_series` because a day
 * with no revenue produces no row in either query, and a line chart that skips
 * missing days draws a straight segment across a dead week as if it were a
 * gentle slope.
 */
export function buildRevenueSeries(
  range: Pick<DateRange, "from" | "days">,
  cashRows: Record<string, unknown>[],
  managementRows: Record<string, unknown>[]
): RevenueDayPoint[] {
  const cash = new Map<string, number>();
  for (const row of cashRows) cash.set(str(row.day), num(row.baht));

  const management = new Map<string, number>();
  for (const row of managementRows) {
    management.set(str(row.day), int(row.credits) * CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE);
  }

  const points: RevenueDayPoint[] = [];
  for (let i = 0; i < range.days; i += 1) {
    const date = toBangkokDateInput(new Date(range.from.getTime() + i * 86_400_000));
    points.push({
      date,
      videoGenerationBaht: cash.get(date) ?? 0,
      channelManagementBaht: management.get(date) ?? 0,
    });
  }
  return points;
}

// ─── CSV serialisation ───────────────────────────────────────────────────────
// Lives here rather than in the route module because Next type-checks a
// `route.ts` export shape and rejects anything that is not a handler; keeping
// these beside `getMoneyEvents` also means the rows and their encoding are
// tested together.

const CSV_COLUMNS = [
  "occurred_at_utc",
  "source",
  "revenue_line",
  "unit",
  "amount_baht",
  "amount_credits",
  "status",
  "product_code",
  "channel",
  "user_id",
  "user_email",
  "reference",
  "description",
] as const;

/**
 * RFC 4180 field escaping.
 *
 * Quotes are added only when needed, so the file stays readable in a text
 * editor. The cases that force them are real here, not theoretical:
 * `credit_transactions.description` is free text written by the services and
 * the product labels are Thai with commas in them. An unescaped quote silently
 * shifts every column after it, which is the failure mode nobody notices until
 * the numbers have already been reported.
 */
export function csvField(value: string | number): string {
  let text = typeof value === "number" ? String(value) : value;

  // Spreadsheet formula injection: Excel and Sheets evaluate a cell that opens
  // with = + - or @, so a description of `=HYPERLINK(...)` becomes live content
  // in the reader's spreadsheet. A leading apostrophe defuses it and still
  // reads as the original text.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Money events → CSV text.
 *
 * The leading BOM is not decoration: descriptions and product labels are Thai,
 * and Excel on Windows decodes a BOM-less UTF-8 file as the system code page,
 * turning every Thai string into mojibake. Baht is fixed to two decimals so the
 * column types as currency instead of a mix of integers and floats.
 */
export function toCsv(rows: MoneyEventRow[]): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];

  for (const row of rows) {
    lines.push(
      [
        csvField(row.occurredAt),
        csvField(row.source),
        csvField(row.line),
        csvField(row.unit),
        csvField(row.amountBaht.toFixed(2)),
        csvField(row.amountCredits),
        csvField(row.status),
        csvField(row.productCode),
        csvField(row.channel),
        csvField(row.userId),
        csvField(row.userEmail),
        csvField(row.reference),
        csvField(row.description),
      ].join(",")
    );
  }

  // CRLF is what RFC 4180 specifies and what Excel expects.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export const adminPaymentsService = new AdminPaymentsService();

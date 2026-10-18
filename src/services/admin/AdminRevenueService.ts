import { pool } from "@/lib/db";
import { toBangkokDateInput } from "@/features/admin/dateRange";
import { STORE_COMMISSION, storeProductsFor } from "@/config/mobilePurchases";
import { toDateOrNull, toInt, toNumberOrNull, type MetricsRange } from "@/services/admin/analyticsShared";

/**
 * Revenue — the real money users pay, by channel (Analytics, Oct 2026).
 *
 * Three ways money comes in, all of them buying CREDITS (credits then buy
 * video packages, Channel Management and voice makes):
 *
 *   Stripe       payment_intents, status 'paid'. PromptPay QR or card, always
 *                THB, the amount is what Stripe charged. Stripe's own fee is not
 *                recorded, so Stripe is reported gross.
 *   App Store    mobile_store_purchases, platform 'ios'.
 *   Google Play  mobile_store_purchases, platform 'android'.
 *                Store rows from before migration 042 carry no price; they are
 *                valued at the catalogue's planned price and marked estimated.
 *                Net is gross minus the small-business store commission
 *                (STORE_COMMISSION.smallBusiness) — an estimate before VAT/tax;
 *                App Store Connect / Play Console payouts are the truth.
 *                Sandbox / test purchases are never revenue: counted aside.
 *
 * Money is only ever summed within one currency. THB is the headline; any
 * other currency (a foreign storefront) is listed beside it, never converted.
 *
 * Rows are read individually for the range (a few thousand at most) and
 * aggregated in TypeScript, so every figure on the page comes from one list
 * and the aggregation is unit-tested without a database.
 */

export type RevenueChannel = "stripe_promptpay" | "stripe_card" | "app_store" | "google_play";

export const CHANNEL_LABELS: Record<RevenueChannel, string> = {
  stripe_promptpay: "Stripe · PromptPay",
  stripe_card: "Stripe · Card",
  app_store: "App Store",
  google_play: "Google Play",
};

export const CHANNEL_ORDER: RevenueChannel[] = [
  "stripe_promptpay",
  "stripe_card",
  "app_store",
  "google_play",
];

/** One successful real-money payment. */
export interface PaymentRow {
  channel: RevenueChannel;
  userId: string;
  email: string;
  amount: number;
  currency: string;
  credits: number;
  /** Product id for stores; "฿N top-up" for Stripe. */
  product: string;
  at: Date;
  /** Price not recorded; valued from the catalogue. */
  estimated: boolean;
}

/** A Stripe checkout attempt, whatever happened to it. */
export interface StripeAttemptRow {
  method: "promptpay_qr" | "card" | string;
  status: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelSummary {
  channel: RevenueChannel;
  label: string;
  payments: number;
  payingUsers: number;
  grossThb: number;
  /** After store commission for stores; equal to gross for Stripe (fee unknown). */
  netThb: number;
  avgThb: number | null;
  credits: number;
  estimatedPayments: number;
  /** Money in other currencies, never converted. */
  otherCurrencies: { currency: string; amount: number; payments: number }[];
}

export interface StripeFunnelRow {
  method: string;
  label: string;
  started: number;
  paid: number;
  expired: number;
  failed: number;
  pending: number;
  paidPct: number | null;
  medianMinutesToPay: number | null;
}

export interface ProductRow {
  channel: RevenueChannel;
  product: string;
  payments: number;
  grossThb: number;
  credits: number;
}

export interface PayerRow {
  email: string;
  payments: number;
  grossThb: number;
  channels: string[];
  lastAt: Date;
  firstEver: Date | null;
}

export interface DailyRevenuePoint {
  date: string;
  stripe_promptpay: number;
  stripe_card: number;
  app_store: number;
  google_play: number;
  total: number;
}

export interface CreditUseRow {
  label: string;
  credits: number;
  transactions: number;
}

export interface RevenueReport {
  totals: {
    grossThb: number;
    netThb: number;
    payments: number;
    payingUsers: number;
    /** Paying users whose first-ever payment fell inside the range. */
    newPayers: number;
    repeatPayers: number;
    arppuThb: number | null;
  };
  channels: ChannelSummary[];
  daily: DailyRevenuePoint[];
  stripeFunnel: StripeFunnelRow[];
  products: ProductRow[];
  topPayers: PayerRow[];
  recent: PaymentRow[];
  /** New users in range, and how many of them have ever paid. */
  signupConversion: { newUsers: number; paid: number; medianDaysToFirstPayment: number | null };
  creditUse: CreditUseRow[];
  dataNotes: {
    storeTestPurchases: number;
    estimatedStorePayments: number;
    commissionRate: number;
  };
}

interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The catalogue's planning price for a store product, or null. */
export function plannedPriceBaht(platform: "ios" | "android", productId: string): number | null {
  return storeProductsFor(platform).find((p) => p.productId === productId)?.plannedPriceBaht ?? null;
}

const isStoreChannel = (channel: RevenueChannel) =>
  channel === "app_store" || channel === "google_play";

/** Production purchases only; Sandbox (Apple) and Test (Google) are not revenue. */
export function isProductionStoreEnvironment(environment: string | null | undefined): boolean {
  return /^production$/i.test(String(environment ?? "").trim());
}

/** Turn a store purchase row into a payment, valuing it from the catalogue if unpriced. */
export function storeRowToPayment(row: Record<string, unknown>): PaymentRow {
  const platform = row.platform === "ios" ? "ios" : "android";
  const recorded = toNumberOrNull(row.price_amount);
  const planned = plannedPriceBaht(platform, String(row.product_id));
  const estimated = recorded === null;
  return {
    channel: platform === "ios" ? "app_store" : "google_play",
    userId: String(row.user_id),
    email: String(row.email ?? ""),
    amount: recorded ?? planned ?? 0,
    currency: recorded !== null ? String(row.price_currency ?? "THB").toUpperCase() : "THB",
    credits: toInt(row.credits_granted),
    product: String(row.product_id),
    at: toDateOrNull(row.at) ?? new Date(0),
    estimated,
  };
}

export function stripeRowToPayment(row: Record<string, unknown>): PaymentRow {
  const amount = toNumberOrNull(row.amount_baht) ?? 0;
  return {
    channel: row.method === "card" ? "stripe_card" : "stripe_promptpay",
    userId: String(row.user_id),
    email: String(row.email ?? ""),
    amount,
    currency: "THB",
    credits: toInt(row.credits_to_add),
    product: `฿${amount.toLocaleString("en-US")} top-up`,
    at: toDateOrNull(row.created_at) ?? new Date(0),
    estimated: false,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Net THB of a payment: store commission off for stores; Stripe stays gross. */
export function netOf(payment: PaymentRow, commissionRate: number): number {
  return isStoreChannel(payment.channel) ? payment.amount * (1 - commissionRate) : payment.amount;
}

/** Bangkok days from..to (exclusive) as YYYY-MM-DD. */
function bangkokDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  let cursor = toBangkokDateInput(from);
  const last = toBangkokDateInput(new Date(to.getTime() - 1));
  for (let guard = 0; guard < 800; guard += 1) {
    days.push(cursor);
    if (cursor >= last) break;
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return days;
}

/** Everything on the page from the raw lists. Pure; tested directly. */
export function buildRevenueReport(input: {
  range: MetricsRange;
  payments: PaymentRow[];
  stripeAttempts: StripeAttemptRow[];
  /** userId → first-ever real payment, any channel. */
  firstPaymentAt: Map<string, Date>;
  signupConversion: RevenueReport["signupConversion"];
  creditUse: CreditUseRow[];
  storeTestPurchases: number;
  commissionRate?: number;
}): RevenueReport {
  const commission = input.commissionRate ?? STORE_COMMISSION.smallBusiness;
  const payments = [...input.payments].sort((a, b) => b.at.getTime() - a.at.getTime());
  const thb = payments.filter((p) => p.currency === "THB");

  const channels: ChannelSummary[] = CHANNEL_ORDER.map((channel) => {
    const all = payments.filter((p) => p.channel === channel);
    const inThb = all.filter((p) => p.currency === "THB");
    const gross = inThb.reduce((sum, p) => sum + p.amount, 0);
    const others = new Map<string, { amount: number; payments: number }>();
    for (const p of all.filter((x) => x.currency !== "THB")) {
      const entry = others.get(p.currency) ?? { amount: 0, payments: 0 };
      entry.amount += p.amount;
      entry.payments += 1;
      others.set(p.currency, entry);
    }
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      payments: all.length,
      payingUsers: new Set(all.map((p) => p.userId)).size,
      grossThb: round2(gross),
      netThb: round2(inThb.reduce((sum, p) => sum + netOf(p, commission), 0)),
      avgThb: inThb.length > 0 ? round2(gross / inThb.length) : null,
      credits: all.reduce((sum, p) => sum + p.credits, 0),
      estimatedPayments: all.filter((p) => p.estimated).length,
      otherCurrencies: [...others.entries()].map(([currency, v]) => ({
        currency,
        amount: round2(v.amount),
        payments: v.payments,
      })),
    };
  });

  // Daily THB per channel; every day present so the chart has no gaps.
  const dayIndex = new Map<string, DailyRevenuePoint>();
  for (const date of bangkokDays(input.range.from, input.range.to)) {
    dayIndex.set(date, { date, stripe_promptpay: 0, stripe_card: 0, app_store: 0, google_play: 0, total: 0 });
  }
  for (const p of thb) {
    const point = dayIndex.get(toBangkokDateInput(p.at));
    if (!point) continue;
    point[p.channel] = round2(point[p.channel] + p.amount);
    point.total = round2(point.total + p.amount);
  }

  const payers = new Map<string, PaymentRow[]>();
  for (const p of payments) payers.set(p.userId, [...(payers.get(p.userId) ?? []), p]);
  let newPayers = 0;
  for (const userId of payers.keys()) {
    const first = input.firstPaymentAt.get(userId);
    if (first && first >= input.range.from && first < input.range.to) newPayers += 1;
  }
  const grossThb = round2(thb.reduce((sum, p) => sum + p.amount, 0));

  const topPayers: PayerRow[] = [...payers.entries()]
    .map(([userId, rows]) => ({
      email: rows[0].email,
      payments: rows.length,
      grossThb: round2(rows.filter((r) => r.currency === "THB").reduce((s, r) => s + r.amount, 0)),
      channels: [...new Set(rows.map((r) => CHANNEL_LABELS[r.channel]))],
      lastAt: rows[0].at,
      firstEver: input.firstPaymentAt.get(userId) ?? null,
    }))
    .sort((a, b) => b.grossThb - a.grossThb || b.payments - a.payments)
    .slice(0, 15);

  const productMap = new Map<string, ProductRow>();
  for (const p of payments) {
    const key = `${p.channel}|${p.product}`;
    const row = productMap.get(key) ?? { channel: p.channel, product: p.product, payments: 0, grossThb: 0, credits: 0 };
    row.payments += 1;
    if (p.currency === "THB") row.grossThb = round2(row.grossThb + p.amount);
    row.credits += p.credits;
    productMap.set(key, row);
  }

  const methods = [...new Set(input.stripeAttempts.map((a) => a.method))].sort();
  const stripeFunnel: StripeFunnelRow[] = methods.map((method) => {
    const rows = input.stripeAttempts.filter((a) => a.method === method);
    const count = (status: string) => rows.filter((r) => r.status === status).length;
    const paidRows = rows.filter((r) => r.status === "paid");
    return {
      method,
      label: method === "card" ? "Card" : method === "promptpay_qr" ? "PromptPay QR" : method,
      started: rows.length,
      paid: paidRows.length,
      expired: count("expired"),
      failed: count("failed"),
      pending: count("pending"),
      paidPct: rows.length > 0 ? (paidRows.length / rows.length) * 100 : null,
      medianMinutesToPay: median(
        paidRows.map((r) => (r.updatedAt.getTime() - r.createdAt.getTime()) / 60_000)
      ),
    };
  });

  return {
    totals: {
      grossThb,
      netThb: round2(thb.reduce((sum, p) => sum + netOf(p, commission), 0)),
      payments: payments.length,
      payingUsers: payers.size,
      newPayers,
      repeatPayers: [...payers.values()].filter((rows) => rows.length > 1).length,
      arppuThb: payers.size > 0 ? round2(grossThb / payers.size) : null,
    },
    channels,
    daily: [...dayIndex.values()],
    stripeFunnel,
    products: [...productMap.values()].sort((a, b) => b.grossThb - a.grossThb || b.payments - a.payments),
    topPayers,
    recent: payments.slice(0, 30),
    signupConversion: input.signupConversion,
    creditUse: input.creditUse,
    dataNotes: {
      storeTestPurchases: input.storeTestPurchases,
      estimatedStorePayments: payments.filter((p) => p.estimated).length,
      commissionRate: commission,
    },
  };
}

// ── SQL ──────────────────────────────────────────────────────────────────────

const STRIPE_SQL = `
  SELECT pi.user_id::text AS user_id, u.email, pi.method, pi.status, pi.amount_baht,
         pi.credits_to_add, pi.created_at, pi.updated_at
    FROM payment_intents pi
    LEFT JOIN users u ON u.id::text = pi.user_id::text
   WHERE pi.created_at >= $1 AND pi.created_at < $2`;

/**
 * Store purchases. The price columns come from migration 042; before it is
 * applied they are selected as NULL so the page still works (all estimated).
 */
function storeSql(hasPriceColumns: boolean): string {
  const price = hasPriceColumns
    ? "m.price_amount, m.price_currency"
    : "NULL::numeric AS price_amount, NULL::text AS price_currency";
  return `
  SELECT m.user_id::text AS user_id, u.email, m.platform, m.product_id, m.credits_granted,
         m.store_environment, ${price},
         COALESCE(m.purchased_at, m.created_at) AS at
    FROM mobile_store_purchases m
    LEFT JOIN users u ON u.id::text = m.user_id::text
   WHERE COALESCE(m.purchased_at, m.created_at) >= $1
     AND COALESCE(m.purchased_at, m.created_at) <  $2`;
}

/** First-ever real payment per user, across Stripe and production store purchases. */
const FIRST_PAYMENT_SQL = `
  SELECT user_id, MIN(at) AS first_at FROM (
    SELECT pi.user_id::text AS user_id, pi.created_at AS at
      FROM payment_intents pi WHERE pi.status = 'paid'
    UNION ALL
    SELECT m.user_id::text, COALESCE(m.purchased_at, m.created_at)
      FROM mobile_store_purchases m WHERE m.store_environment ILIKE 'production'
  ) paid
  GROUP BY user_id`;

/** New users in range, how many have ever paid, and the median days to the first payment. */
const SIGNUP_CONVERSION_SQL = `
  WITH cohort AS (
    SELECT u.id::text AS uid, u.created_at
      FROM users u
     WHERE u.deleted_at IS NULL AND COALESCE(u.role, 'requester') <> 'admin'
       AND u.created_at >= $1 AND u.created_at < $2
  ),
  first_paid AS (
    ${FIRST_PAYMENT_SQL}
  )
  SELECT COUNT(*)::int AS new_users,
         COUNT(fp.user_id)::int AS paid,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (fp.first_at - c.created_at)) / 86400.0
         ) FILTER (WHERE fp.user_id IS NOT NULL)::float8 AS median_days
    FROM cohort c
    LEFT JOIN first_paid fp ON fp.user_id = c.uid`;

/** What credits were spent on in the range (debits are negative amounts). */
const CREDIT_USE_SQL = `
  SELECT CASE
           WHEN ct.type = 'request_charge' AND ct.description ILIKE 'Video package:%' THEN 'Video packages'
           WHEN ct.type = 'request_charge' THEN 'Per-video charges (old model)'
           WHEN ct.type = 'management_purchase' THEN 'Channel Management'
           WHEN ct.type = 'voice_make_top_up' THEN 'Extra voice makes'
           WHEN ct.type = 'admin_debit' THEN 'Admin debits'
         END AS label,
         SUM(ABS(ct.amount))::int AS credits,
         COUNT(*)::int AS transactions
    FROM credit_transactions ct
   WHERE ct.created_at >= $1 AND ct.created_at < $2
     AND ct.type IN ('request_charge', 'management_purchase', 'voice_make_top_up', 'admin_debit')
   GROUP BY 1
   ORDER BY 2 DESC`;

export class AdminRevenueService {
  constructor(private db: QueryableDb = pool) {}

  private async hasStorePriceColumns(): Promise<boolean> {
    try {
      const { rows } = await this.db.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'mobile_store_purchases' AND column_name = 'price_amount'
          LIMIT 1`
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  async getReport(range: MetricsRange, commissionRate?: number): Promise<RevenueReport> {
    const bounds = [range.from, range.to];
    const priced = await this.hasStorePriceColumns();
    const [stripeRes, storeRes, firstRes, conversionRes, creditRes] = await Promise.all([
      this.db.query(STRIPE_SQL, bounds),
      this.db.query(storeSql(priced), bounds),
      this.db.query(FIRST_PAYMENT_SQL),
      this.db.query(SIGNUP_CONVERSION_SQL, bounds),
      this.db.query(CREDIT_USE_SQL, bounds),
    ]);

    const stripeAttempts: StripeAttemptRow[] = stripeRes.rows.map((row) => ({
      method: String(row.method),
      status: String(row.status),
      amount: toNumberOrNull(row.amount_baht) ?? 0,
      createdAt: toDateOrNull(row.created_at) ?? new Date(0),
      updatedAt: toDateOrNull(row.updated_at) ?? new Date(0),
    }));
    const production = storeRes.rows.filter((row) => isProductionStoreEnvironment(String(row.store_environment)));
    const payments: PaymentRow[] = [
      ...stripeRes.rows.filter((row) => row.status === "paid").map(stripeRowToPayment),
      ...production.map(storeRowToPayment),
    ];
    const conversion = conversionRes.rows[0] ?? {};

    return buildRevenueReport({
      range,
      payments,
      stripeAttempts,
      firstPaymentAt: new Map(
        firstRes.rows
          .map((row) => [String(row.user_id), toDateOrNull(row.first_at)] as const)
          .filter((entry): entry is readonly [string, Date] => entry[1] !== null)
      ),
      signupConversion: {
        newUsers: toInt(conversion.new_users),
        paid: toInt(conversion.paid),
        medianDaysToFirstPayment: toNumberOrNull(conversion.median_days),
      },
      creditUse: creditRes.rows
        .filter((row) => row.label)
        .map((row) => ({
          label: String(row.label),
          credits: toInt(row.credits),
          transactions: toInt(row.transactions),
        })),
      storeTestPurchases: storeRes.rows.length - production.length,
      commissionRate,
    });
  }
}

export const adminRevenueService = new AdminRevenueService();

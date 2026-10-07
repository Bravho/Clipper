/**
 * Chinese_TTT outcome connectors: LINE OA friends + Stripe revenue (read-only).
 */

import { pool } from "@/lib/db";
import { fetchLineFriendCount } from "@/services/ad-lab/lineOfficialAccountClient";
import { fetchStripeRevenue } from "@/services/ad-lab/stripeRevenueClient";

export interface LineFriendsSeriesPoint {
  capturedAt: string;
  friendCount: number;
  source: string;
}

export interface LineFriendsOutcome {
  stub: boolean;
  message: string;
  latest: LineFriendsSeriesPoint | null;
  previous: LineFriendsSeriesPoint | null;
  delta: number | null;
  series: LineFriendsSeriesPoint[];
}

export interface StripeRevenueOutcome {
  stub: boolean;
  message: string;
  amountBaht: number;
  chargeCount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  productFilter: string;
}

export class AdLabOutcomesService {
  async captureLineFriends(ownerId: string, brandId: string): Promise<LineFriendsOutcome> {
    const snap = await fetchLineFriendCount();
    try {
      await pool.query(
        "INSERT INTO ad_lab_line_friend_snapshots (owner_id, brand_id, friend_count, source, raw)\n"
        + " VALUES ($1, $2, $3, $4, $5::jsonb)",
        [ownerId, brandId, snap.friendCount, snap.stub ? "stub" : "line_oa", JSON.stringify(snap.raw ?? {})]
      );
    } catch (err) {
      console.warn("[AdLabOutcomesService] line snapshots table unavailable — apply migration 040:", err);
    }
    return this.getLineFriends(ownerId, brandId, snap.message, snap.stub);
  }

  async getLineFriends(
    ownerId: string,
    brandId: string,
    message = "",
    stub?: boolean
  ): Promise<LineFriendsOutcome> {
    let series: LineFriendsSeriesPoint[] = [];
    try {
      const { rows } = await pool.query<{
        captured_at: Date;
        friend_count: number;
        source: string;
      }>(
        "SELECT captured_at, friend_count, source\n"
        + "  FROM ad_lab_line_friend_snapshots\n"
        + " WHERE owner_id = $1 AND brand_id = $2\n"
        + " ORDER BY captured_at DESC\n"
        + " LIMIT 60",
        [ownerId, brandId]
      );
      series = rows
        .map((r) => ({
          capturedAt: new Date(r.captured_at).toISOString(),
          friendCount: Number(r.friend_count) || 0,
          source: r.source,
        }))
        .reverse();
    } catch {
      series = [];
    }

    const latest = series.length ? series[series.length - 1] : null;
    const previous = series.length > 1 ? series[series.length - 2] : null;
    const delta =
      latest && previous ? latest.friendCount - previous.friendCount : null;

    return {
      stub: stub ?? (latest?.source === "stub" || series.length === 0),
      message: message || (series.length ? "LINE friend history loaded." : "No LINE snapshots yet."),
      latest,
      previous,
      delta,
      series,
    };
  }

  async captureStripeRevenue(
    ownerId: string,
    brandId: string,
    days = 30
  ): Promise<StripeRevenueOutcome> {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - Math.max(1, days) * 86_400_000);
    const snap = await fetchStripeRevenue({ periodStart, periodEnd });

    try {
      await pool.query(
        "INSERT INTO ad_lab_stripe_revenue_snapshots\n"
        + "  (owner_id, brand_id, period_start, period_end, amount_baht, charge_count, currency, product_filter, raw)\n"
        + " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
        [
          ownerId,
          brandId,
          periodStart.toISOString(),
          periodEnd.toISOString(),
          snap.amountBaht,
          snap.chargeCount,
          snap.currency,
          snap.productFilter,
          JSON.stringify(snap.raw ?? {}),
        ]
      );
    } catch (err) {
      console.warn("[AdLabOutcomesService] stripe snapshots table unavailable — apply migration 040:", err);
    }

    return {
      stub: snap.stub,
      message: snap.message,
      amountBaht: snap.amountBaht,
      chargeCount: snap.chargeCount,
      currency: snap.currency,
      periodStart: snap.periodStart,
      periodEnd: snap.periodEnd,
      productFilter: snap.productFilter,
    };
  }
}

export const adLabOutcomesService = new AdLabOutcomesService();

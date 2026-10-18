/**
 * Small helpers shared by the admin analytics services.
 *
 * These lived in AdminApprovalMetricsService until that page was replaced by
 * Studio Activity (Oct 2026); the capacity page still needs them.
 */

import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";

export interface MetricsRange {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}

/** A duration in seconds as "42s", "5m 10s", "3h 5m", "2d 4h"; "—" for nonsense. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return rest === 0 ? `${mins}m` : `${mins}m ${rest}s`;
  }
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.round((seconds % 86_400) / 3600);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/**
 * `pg` hands back COUNT/SUM/NUMERIC as strings. Parse defensively; anything
 * unparseable is zero rather than NaN.
 */
export function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** Like toInt but keeps fractions and returns null for missing values. */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * How many times each (day-of-week, hour) slot occurs inside the range, in
 * Bangkok, Sunday-first. A count alone is not a rate: "40 events on Monday
 * 20:00" over 90 days is thirteen Mondays, not one.
 */
export function countHourSlots(from: Date, to: Date): number[][] {
  const slots: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const HOUR_MS = 3_600_000;
  // Thailand has no daylight saving, so a fixed +07:00 shift is exact.
  const BANGKOK_OFFSET_MS = 7 * HOUR_MS;
  const start = Math.floor(from.getTime() / HOUR_MS) * HOUR_MS;
  for (let t = start; t < to.getTime(); t += HOUR_MS) {
    if (t < from.getTime()) continue;
    const local = new Date(t + BANGKOK_OFFSET_MS);
    slots[local.getUTCDay()][local.getUTCHours()] += 1;
  }
  return slots;
}

export { REPORTING_TIMEZONE };

/**
 * Pure analysis functions for ads reporting.
 * No side effects, no network calls, no writes to any store.
 * All budget suggestions are text recommendations only — the system never
 * modifies budgets or campaigns automatically.
 */
import type { NormalizedAdMetricRow } from "./adsReportingModel";
import { resultLabel } from "./metaResults";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EfficiencyRanking {
  entityId: string;
  entityName?: string;
  level: NormalizedAdMetricRow["level"];
  platform: "tiktok" | "meta";
  totalSpend: number;
  spendShare: number; // 0–1
  totalConversions: number | null;
  costPerResult: number | null;
  /** Summed video plays; null when no row carries video data (non-video ads or old rows). */
  totalVideoPlays: number | null;
  /** Spend / video plays; null when plays are null or 0. */
  costPerView: number | null;
  cpc: number | null;
  cpm: number | null;
  lowData: boolean;
  /** Result type behind totalConversions; "mixed" when rows disagree (then results are not summed). */
  resultType?: string;
  resultLabelTh?: string;
  resultLabelEn?: string;
}

export interface FatigueSignal {
  entityId: string;
  entityName?: string;
  level: NormalizedAdMetricRow["level"];
  platform: "tiktok" | "meta";
  /** CTR in first half of window */
  ctrBefore: number;
  /** CTR in second half of window */
  ctrAfter: number;
  ctrDropPct: number;
  /** Frequency in first half (null if not available) */
  freqBefore: number | null;
  /** Frequency in second half */
  freqAfter: number | null;
  freqRisePct: number | null;
}

export interface PlatformComparison {
  platform: "tiktok" | "meta";
  totalSpend: number;
  currency?: string;
  currencyMixed: boolean;
  avgCtr: number | null;
  avgCpc: number | null;
  avgCpm: number | null;
  totalConversions: number | null;
  avgCostPerResult: number | null;
  avgRoas: number | null;
  /** Distinct result types; when more than one, totals are null (different types are never summed). */
  resultTypes: string[];
  resultsMixed: boolean;
}

export interface BudgetSuggestion {
  entityId: string;
  entityName?: string;
  level: NormalizedAdMetricRow["level"];
  platform: "tiktok" | "meta";
  /** Thai-language recommendation text */
  suggestion: string;
  reason: string;
  evidence: string;
}

// ─── rankByEfficiency ─────────────────────────────────────────────────────────

const LOW_DATA_SPEND_THRESHOLD = 500; // THB / USD depending on currency

/** Aggregate rows per entity, sort by cost-per-result asc (fallback CPC, then CPM). */
export function rankByEfficiency(
  rows: NormalizedAdMetricRow[],
  level: NormalizedAdMetricRow["level"],
): EfficiencyRanking[] {
  const filtered = rows.filter((r) => r.level === level);
  if (!filtered.length) return [];

  const map = new Map<
    string,
    {
      entityId: string;
      entityName?: string;
      platform: "tiktok" | "meta";
      spend: number;
      conversions: number | null;
      cpc: number | null;
      cpm: number | null;
      clicks: number;
      impressions: number;
      videoPlays: number | null;
      resultType?: string;
    }
  >();

  for (const row of filtered) {
    const entityId = entityIdForLevel(row, level);
    if (!entityId) continue;
    const existing = map.get(entityId);
    if (!existing) {
      map.set(entityId, {
        entityId,
        entityName: entityNameForLevel(row, level),
        platform: row.platform,
        spend: row.spend,
        conversions: row.conversions,
        cpc: row.cpc,
        cpm: row.cpm,
        clicks: row.clicks,
        impressions: row.impressions,
        videoPlays: row.videoPlays ?? null,
        resultType: row.resultType,
      });
    } else {
      if (row.resultType && existing.resultType && row.resultType !== existing.resultType) {
        existing.resultType = "mixed";
      } else if (row.resultType && !existing.resultType) {
        existing.resultType = row.resultType;
      }
      existing.spend += row.spend;
      if (row.conversions != null) {
        existing.conversions = (existing.conversions ?? 0) + row.conversions;
      }
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      if (row.videoPlays != null) existing.videoPlays = (existing.videoPlays ?? 0) + row.videoPlays;
    }
  }

  const totalSpend = Array.from(map.values()).reduce((s, e) => s + e.spend, 0);

  const rankings: EfficiencyRanking[] = Array.from(map.values()).map((e) => {
    const mixed = e.resultType === "mixed";
    if (mixed) e.conversions = null; // never sum different result types
    const cpr =
      e.conversions != null && e.conversions > 0
        ? e.spend / e.conversions
        : null;
    const lbl = e.resultType ? resultLabel(e.resultType) : undefined;
    const cpc =
      e.clicks > 0 ? e.spend / e.clicks : e.cpc;
    const cpm =
      e.impressions > 0 ? (e.spend / e.impressions) * 1000 : e.cpm;

    return {
      entityId: e.entityId,
      entityName: e.entityName,
      level,
      platform: e.platform,
      totalSpend: e.spend,
      spendShare: totalSpend > 0 ? e.spend / totalSpend : 0,
      totalConversions: e.conversions,
      costPerResult: cpr,
      totalVideoPlays: e.videoPlays,
      costPerView: e.videoPlays != null && e.videoPlays > 0 ? e.spend / e.videoPlays : null,
      cpc,
      cpm,
      lowData: e.spend < LOW_DATA_SPEND_THRESHOLD,
      ...(e.resultType ? { resultType: e.resultType, resultLabelTh: lbl?.th, resultLabelEn: lbl?.en } : {}),
    };
  });

  rankings.sort((a, b) => {
    const primary = sortKey(a) - sortKey(b);
    if (primary !== 0) return primary;
    return a.totalSpend - b.totalSpend;
  });

  return rankings;
}

function sortKey(r: EfficiencyRanking): number {
  if (r.costPerResult != null) return r.costPerResult;
  if (r.cpc != null) return r.cpc * 1e6; // push past conversion-based
  if (r.cpm != null) return r.cpm * 1e9;
  return Infinity;
}

function entityIdForLevel(row: NormalizedAdMetricRow, level: NormalizedAdMetricRow["level"]): string {
  if (level === "campaign") return row.campaignId;
  if (level === "adset") return row.adsetId ?? "";
  return row.adId ?? "";
}

function entityNameForLevel(row: NormalizedAdMetricRow, level: NormalizedAdMetricRow["level"]): string | undefined {
  if (level === "campaign") return row.campaignName;
  if (level === "adset") return row.adsetName;
  return row.adName;
}

// ─── detectFatigue ────────────────────────────────────────────────────────────

export interface DetectFatigueOptions {
  windowDays?: number;
  minImpressions?: number;
}

const DEFAULT_CTR_DROP_THRESHOLD = 0.2; // 20%
const DEFAULT_FREQ_RISE_THRESHOLD = 0.2; // 20%
const DEFAULT_MIN_IMPRESSIONS = 1000;

/**
 * Compare first-half vs second-half of the date window per entity.
 * Flags when CTR drops ≥20% while frequency rises ≥20%.
 * Entities with null frequency are included in output with freqRisePct=null and flagged
 * for CTR drop alone with a note that frequency data was unavailable.
 */
export function detectFatigue(
  rows: NormalizedAdMetricRow[],
  options: DetectFatigueOptions = {},
): FatigueSignal[] {
  const { minImpressions = DEFAULT_MIN_IMPRESSIONS } = options;

  if (!rows.length) return [];

  // Sort dates for window split
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  if (dates.length < 2) return [];

  const half = Math.floor(dates.length / 2);
  const firstHalf = new Set(dates.slice(0, half));
  const secondHalf = new Set(dates.slice(half));

  // Aggregate per entity across ad levels (use ad-level when present)
  type HalfData = { clicks: number; impressions: number; frequency: number | null; freqCount: number };
  const entityMap = new Map<string, { first: HalfData; second: HalfData; row: NormalizedAdMetricRow }>();

  for (const row of rows) {
    const entityId = row.adId ?? row.adsetId ?? row.campaignId;
    if (!entityId) continue;

    const inFirst = firstHalf.has(row.date);
    const inSecond = secondHalf.has(row.date);
    if (!inFirst && !inSecond) continue;

    const existing = entityMap.get(entityId);
    const blank = (): HalfData => ({ clicks: 0, impressions: 0, frequency: null, freqCount: 0 });
    const entry = existing ?? { first: blank(), second: blank(), row };
    if (!existing) entityMap.set(entityId, entry);

    const target = inFirst ? entry.first : entry.second;
    target.clicks += row.clicks;
    target.impressions += row.impressions;
    if (row.frequency != null) {
      target.frequency = (target.frequency ?? 0) + row.frequency;
      target.freqCount++;
    }
  }

  const signals: FatigueSignal[] = [];

  for (const [, entry] of entityMap) {
    const { first, second, row } = entry;
    const totalImpressions = first.impressions + second.impressions;
    if (totalImpressions < minImpressions) continue;
    if (!first.impressions || !second.impressions) continue;

    const ctrBefore = (first.clicks / first.impressions) * 100;
    const ctrAfter = (second.clicks / second.impressions) * 100;

    if (ctrBefore <= 0) continue;
    const ctrDrop = (ctrBefore - ctrAfter) / ctrBefore;
    if (ctrDrop < DEFAULT_CTR_DROP_THRESHOLD) continue;

    const freqBefore =
      first.freqCount > 0 ? first.frequency! / first.freqCount : null;
    const freqAfter =
      second.freqCount > 0 ? second.frequency! / second.freqCount : null;

    // Require frequency rise if frequency data is available; skip if no data
    let freqRisePct: number | null = null;
    if (freqBefore != null && freqAfter != null && freqBefore > 0) {
      freqRisePct = (freqAfter - freqBefore) / freqBefore;
      if (freqRisePct < DEFAULT_FREQ_RISE_THRESHOLD) continue; // not rising enough
    } else if (freqBefore != null || freqAfter != null) {
      // Only one half has frequency — skip
      continue;
    }
    // freqBefore and freqAfter both null → flag on CTR drop alone (note: no freq data)

    signals.push({
      entityId: row.adId ?? row.adsetId ?? row.campaignId,
      entityName: row.adName ?? row.adsetName ?? row.campaignName,
      level: row.adId ? "ad" : row.adsetId ? "adset" : "campaign",
      platform: row.platform,
      ctrBefore,
      ctrAfter,
      ctrDropPct: ctrDrop,
      freqBefore,
      freqAfter,
      freqRisePct,
    });
  }

  return signals;
}

// ─── comparePlatforms ─────────────────────────────────────────────────────────

export function comparePlatforms(rows: NormalizedAdMetricRow[]): PlatformComparison[] {
  const platforms = [...new Set(rows.map((r) => r.platform))] as Array<"tiktok" | "meta">;
  return platforms.map((platform) => {
    const pRows = rows.filter((r) => r.platform === platform);
    const currencies = [...new Set(pRows.map((r) => r.currency).filter(Boolean))];
    const totalSpend = pRows.reduce((s, r) => s + r.spend, 0);
    const impressions = pRows.reduce((s, r) => s + r.impressions, 0);
    const clicks = pRows.reduce((s, r) => s + r.clicks, 0);
    const resultTypes = [...new Set(pRows.map((r) => r.resultType).filter((t): t is string => !!t))];
    const resultsMixed = resultTypes.length > 1;
    const conversions = !resultsMixed && pRows.some((r) => r.conversions != null)
      ? pRows.reduce((s, r) => s + (r.conversions ?? 0), 0)
      : null;

    return {
      platform,
      totalSpend,
      currency: currencies.length === 1 ? (currencies[0] as string) : undefined,
      currencyMixed: currencies.length > 1,
      avgCtr: impressions > 0 ? (clicks / impressions) * 100 : null,
      avgCpc: clicks > 0 ? totalSpend / clicks : null,
      avgCpm: impressions > 0 ? (totalSpend / impressions) * 1000 : null,
      totalConversions: conversions,
      avgCostPerResult: conversions != null && conversions > 0 ? totalSpend / conversions : null,
      avgRoas: pRows
        .filter((r) => r.roas != null)
        .reduce<number | null>(
          (sum, r) => (sum == null ? r.roas! : sum + r.roas!),
          null,
        ),
      resultTypes,
      resultsMixed,
    };
  });
}

// ─── summarizeResultsByType ───────────────────────────────────────────────────

export interface ResultTypeSummary {
  platform: "tiktok" | "meta";
  resultType: string;
  labelTh: string;
  labelEn: string;
  results: number;
  /** Spend of the rows whose result is this type. */
  spend: number;
  costPerResult: number | null;
  entities: number;
}

/**
 * Per-type result totals (pass rows of ONE level). Different result types are
 * never added together; the UI shows one line per type or a "mixed" note.
 */
export function summarizeResultsByType(rows: NormalizedAdMetricRow[]): ResultTypeSummary[] {
  const map = new Map<string, ResultTypeSummary & { ids: Set<string> }>();
  for (const r of rows) {
    if (!r.resultType || r.conversions == null) continue;
    const key = `${r.platform}|${r.resultType}`;
    const lbl = resultLabel(r.resultType);
    const e = map.get(key) ?? { platform: r.platform, resultType: r.resultType, labelTh: lbl.th, labelEn: lbl.en, results: 0, spend: 0, costPerResult: null, entities: 0, ids: new Set<string>() };
    e.results += r.conversions;
    e.spend += r.spend;
    e.ids.add(r.adId ?? r.adsetId ?? r.campaignId);
    map.set(key, e);
  }
  return [...map.values()]
    .map(({ ids, ...e }) => ({ ...e, entities: ids.size, costPerResult: e.results > 0 ? e.spend / e.results : null }))
    .sort((a, b) => b.spend - a.spend);
}

// ─── budgetSuggestions ────────────────────────────────────────────────────────

/**
 * Produces Thai-language text suggestions ONLY.
 * This function does NOT modify any campaign, budget, or ad.
 * Labelled clearly as ข้อเสนอแนะเท่านั้น.
 */
export function budgetSuggestions(
  rows: NormalizedAdMetricRow[],
  level: NormalizedAdMetricRow["level"] = "campaign",
): BudgetSuggestion[] {
  const rankings = rankByEfficiency(rows, level);
  const fatigue = detectFatigue(rows);
  const suggestions: BudgetSuggestion[] = [];

  const totalSpend = rankings.reduce((s, r) => s + r.totalSpend, 0);

  for (const entity of rankings) {
    if (entity.lowData) continue;

    const fatigued = fatigue.some((f) => f.entityId === entity.entityId);

    if (fatigued) {
      suggestions.push({
        entityId: entity.entityId,
        entityName: entity.entityName,
        level,
        platform: entity.platform,
        suggestion: `พิจารณาเปลี่ยนครีเอทีฟหรือพักโฆษณา "${entity.entityName ?? entity.entityId}" เนื่องจากพบสัญญาณครีเอทีฟล้า`,
        reason: "CTR ลดลงพร้อมกับความถี่ที่เพิ่มขึ้น บ่งชี้ว่ากลุ่มเป้าหมายเริ่มเบื่อโฆษณา",
        evidence: `(ข้อเสนอแนะเท่านั้น — ระบบไม่เปลี่ยนงบหรือแคมเปญให้อัตโนมัติ)`,
      });
      continue;
    }

    // Top 30% spenders with good CPR → suggest increasing
    const spendShare = totalSpend > 0 ? entity.totalSpend / totalSpend : 0;
    if (
      spendShare < 0.3 &&
      entity.costPerResult != null &&
      entity.costPerResult < averageCostPerResult(rankings)
    ) {
      suggestions.push({
        entityId: entity.entityId,
        entityName: entity.entityName,
        level,
        platform: entity.platform,
        suggestion: `พิจารณาเพิ่มงบ 10–20% ให้ "${entity.entityName ?? entity.entityId}" เนื่องจากต้นทุนต่อ Conversion ต่ำกว่าค่าเฉลี่ย`,
        reason: `ต้นทุนต่อ Conversion อยู่ที่ ${fmt(entity.costPerResult)} ต่ำกว่าค่าเฉลี่ยของกลุ่ม`,
        evidence: `(ข้อเสนอแนะเท่านั้น — ระบบไม่เปลี่ยนงบหรือแคมเปญให้อัตโนมัติ)`,
      });
    }

    // Bottom 20% efficiency → suggest reducing
    if (
      rankings.length >= 5 &&
      rankings.indexOf(entity) >= Math.floor(rankings.length * 0.8) &&
      entity.costPerResult != null
    ) {
      suggestions.push({
        entityId: entity.entityId,
        entityName: entity.entityName,
        level,
        platform: entity.platform,
        suggestion: `พิจารณาลดหรือพักงบ "${entity.entityName ?? entity.entityId}" เนื่องจากต้นทุนต่อ Conversion สูงกว่าค่าเฉลี่ย`,
        reason: `ต้นทุนต่อ Conversion อยู่ที่ ${fmt(entity.costPerResult)} สูงกว่าค่าเฉลี่ยของกลุ่ม`,
        evidence: `(ข้อเสนอแนะเท่านั้น — ระบบไม่เปลี่ยนงบหรือแคมเปญให้อัตโนมัติ)`,
      });
    }
  }

  return suggestions;
}

function averageCostPerResult(rankings: EfficiencyRanking[]): number {
  const withCpr = rankings.filter((r) => r.costPerResult != null);
  if (!withCpr.length) return Infinity;
  return withCpr.reduce((s, r) => s + r.costPerResult!, 0) / withCpr.length;
}

function fmt(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

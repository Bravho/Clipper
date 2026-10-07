/**
 * Parse pasted / CSV Ads Manager rows into structured import records.
 * Expected header (flexible): campaign, ad_id, spend, impressions, clicks, conversions, revenue
 */

export interface AdLabAdsImportRow {
  campaignName: string;
  adId: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number;
  raw: Record<string, string>;
}

function splitLine(line: string): string[] {
  // Simple CSV: split on comma or tab; strip quotes.
  const parts: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === "," || ch === "\t")) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(String(v).replace(/[฿,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const ALIASES: Record<string, string[]> = {
  campaignName: ["campaign", "campaign_name", "campaign name", "ชื่อแคมเปญ"],
  adId: ["ad_id", "ad id", "ad", "ads_ad_id"],
  spend: ["spend", "cost", "amount_spent", "ค่าโฆษณา", "งบที่ใช้"],
  impressions: ["impressions", "impression", "imps"],
  clicks: ["clicks", "click", "คลิก"],
  conversions: ["conversions", "conversion", "results", "ลูกค้า"],
  revenue: ["revenue", "purchase_value", "ยอดขาย"],
};

function mapHeader(headers: string[]): Record<string, number> {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const out: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const idx = lower.findIndex((h) => aliases.includes(h));
    if (idx >= 0) out[field] = idx;
  }
  return out;
}

/** Parse TSV/CSV text; first row must be a header. */
export function parseAdsManagerCsv(text: string): AdLabAdsImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitLine(lines[0]);
  const map = mapHeader(headers);
  if (map.spend === undefined && map.adId === undefined && map.campaignName === undefined) {
    throw new Error(
      "CSV header not recognised. Need at least campaign / ad_id / spend columns (Thai or English)."
    );
  }

  const rows: AdLabAdsImportRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitLine(line);
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      raw[h] = cols[i] ?? "";
    });
    const pick = (field: string) =>
      map[field] !== undefined ? cols[map[field]] ?? "" : "";
    rows.push({
      campaignName: pick("campaignName"),
      adId: pick("adId"),
      spend: num(pick("spend")) ?? 0,
      impressions: num(pick("impressions")),
      clicks: num(pick("clicks")),
      conversions: num(pick("conversions")),
      revenue: num(pick("revenue")) ?? 0,
      raw,
    });
  }
  return rows;
}

/** Planned vs actual spend helper for Analyze. */
export function plannedVsActual(planned: number, actual: number): {
  planned: number;
  actual: number;
  delta: number;
  pctOfPlan: number | null;
} {
  const p = Math.max(0, planned || 0);
  const a = Math.max(0, actual || 0);
  return {
    planned: p,
    actual: a,
    delta: a - p,
    pctOfPlan: p > 0 ? (a / p) * 100 : null,
  };
}

/**
 * Ad Lab targeting helpers + CSV import + planned vs actual.
 */
import {
  appendAdLabUtm,
  defaultAdLabAdTargeting,
  formatSearchKeywordLines,
  parseSearchKeywordLines,
} from "@/domain/models/AdLabAdTargeting";
import { parseAdsManagerCsv, plannedVsActual } from "@/services/ad-lab/adLabCsvImport";
import { buildTikTokTargetingPayload } from "@/services/ad-lab/tiktokMarketingClient";

describe("AdLab search keywords", () => {
  it("parses include/exclude and match types", () => {
    const parsed = parseSearchKeywordLines('chinese\n"phrase term"\n[exact]\n-bad');
    expect(parsed).toEqual([
      { text: "chinese", matchType: "broad", action: "include" },
      { text: "phrase term", matchType: "phrase", action: "include" },
      { text: "exact", matchType: "exact", action: "include" },
      { text: "bad", matchType: "broad", action: "exclude" },
    ]);
    expect(parseSearchKeywordLines(formatSearchKeywordLines(parsed))).toEqual(parsed);
  });
});

describe("AdLab UTM + targeting payload", () => {
  it("appends utm params and builds a DISABLE payload with keywords", () => {
    const targeting = defaultAdLabAdTargeting({
      searchKeywords: parseSearchKeywordLines("เรียนภาษาจีน\n-spam"),
      locations: ["TH"],
      sparkMode: true,
      sparkPostId: "item123",
    });
    expect(appendAdLabUtm("https://example.com/x", targeting)).toContain("utm_campaign=chinese_ttt");
    const payload = buildTikTokTargetingPayload(targeting);
    expect(payload.operation_status).toBe("DISABLE");
    expect(payload.search_keywords).toEqual([{ keyword: "เรียนภาษาจีน", match_type: "BROAD" }]);
    expect(payload.excluded_keywords).toEqual([{ keyword: "spam", match_type: "BROAD" }]);
  });
});

describe("Ads Manager CSV + planned vs actual", () => {
  it("parses a header row and totals", () => {
    const rows = parseAdsManagerCsv(
      "campaign,ad_id,spend,impressions,clicks,conversions,revenue\nA,ad1,100,1000,10,2,400\n"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe(100);
    expect(rows[0].adId).toBe("ad1");
    const pva = plannedVsActual(200, 100);
    expect(pva.pctOfPlan).toBe(50);
    expect(pva.delta).toBe(-100);
  });
});

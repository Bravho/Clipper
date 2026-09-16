import {
  calculateStudioMetrics,
  diagnoseStudioMetrics,
  generateStudioScriptOutline,
} from "@/services/studio/StudioPrototypeService";
import type { StudioAdResult, StudioBrand } from "@/domain/models/Studio";

const result: StudioAdResult = {
  id: "r1", brandId: "b1", campaignName: "Test", channel: "tiktok",
  spend: 100, revenue: 250, impressions: 1000, views3s: 300,
  completedViews: 90, clicks: 20, conversions: 4, createdAt: "2026-01-01",
};

describe("StudioPrototypeService", () => {
  it("normalises a campaign into comparable funnel metrics", () => {
    const metrics = calculateStudioMetrics([result]);
    expect(metrics.hookRate).toBe(30);
    expect(metrics.completionRate).toBe(30);
    expect(metrics.ctr).toBe(2);
    expect(metrics.cvr).toBe(20);
    expect(metrics.roas).toBe(2.5);
  });

  it("returns safe zero metrics for an empty dataset", () => {
    expect(calculateStudioMetrics([])).toMatchObject({ hookRate: 0, ctr: 0, roas: 0 });
  });

  it("flags weak creative and unprofitable spend", () => {
    const weak = calculateStudioMetrics([{ ...result, views3s: 100, completedViews: 10, clicks: 5, revenue: 50 }]);
    const findings = diagnoseStudioMetrics(weak).join(" ");
    expect(findings).toContain("Hook");
    expect(findings).toContain("รายได้ยังต่ำกว่า");
  });

  it("uses brand context to create a ready-to-speak fallback script", () => {
    const brand: StudioBrand = { id: "b1", name: "RClipper", product: "AI video", audience: "เจ้าของร้าน", promise: "ทำคลิปได้เร็วขึ้น", tone: "จริงใจ", createdAt: "2026-01-01" };
    const outline = generateStudioScriptOutline(brand, {
      mainMessage: "มีเวลาคืนให้ธุรกิจ",
      detailedContent: "เจ้าของร้านใช้เวลาตัดต่อทุกคืน",
      presentationDirection: "storytelling",
      objective: "conversion",
      duration: "30",
    });
    expect(outline.title).toContain("RClipper");
    expect(outline.mainHook).toContain("มีเวลาคืนให้ธุรกิจ");
    expect(outline.sections).toHaveLength(4);
    expect(outline.sections[2].topic).toContain("RClipper");
    expect(outline.hooks).toContain("มีเวลาคืนให้ธุรกิจ");
    expect(outline.painPointsOrIntroduction).toContain("เจ้าของร้านใช้เวลาตัดต่อทุกคืน");
    expect(outline.content).toContain("มีเวลาคืนให้ธุรกิจ");
    expect(outline.solution).toContain("RClipper");
    expect(outline.closing).toContain("เริ่มต้น");
    expect(outline.content).not.toContain("ให้เห็นสถานการณ์จริง");
    expect(outline.content).not.toContain("เล่าด้วยแนวทาง");
    expect(outline.solution).not.toContain("เฉลยให้คุ้ม");
    expect(outline.closing).not.toContain("ปิดกลับมาที่");
    expect(outline.backstage.deliverySequence).toContain("Direction → Lens → Hook");
  });
});

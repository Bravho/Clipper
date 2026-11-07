import {
  calculateAdLabMetrics,
  diagnoseAdLabMetrics,
  generateAdLabScriptOutline,
} from "@/services/ad-lab/AdLabPrototypeService";
import type { AdLabAdResult, AdLabBrand } from "@/domain/models/AdLab";

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as jest.Mock;
});

const result: AdLabAdResult = {
  id: "r1", brandId: "b1", campaignName: "Test", channel: "tiktok",
  spend: 100, revenue: 250, impressions: 1000, views3s: 300,
  completedViews: 90, clicks: 20, conversions: 4, createdAt: "2026-01-01",
};

describe("AdLabPrototypeService", () => {
  it("normalises a campaign into comparable funnel metrics", () => {
    const metrics = calculateAdLabMetrics([result]);
    expect(metrics.hookRate).toBe(30);
    expect(metrics.completionRate).toBe(30);
    expect(metrics.ctr).toBe(2);
    expect(metrics.cvr).toBe(20);
    expect(metrics.roas).toBe(2.5);
  });

  it("returns safe zero metrics for an empty dataset", () => {
    expect(calculateAdLabMetrics([])).toMatchObject({ hookRate: 0, ctr: 0, roas: 0 });
  });

  it("flags weak creative and unprofitable spend", () => {
    const weak = calculateAdLabMetrics([{ ...result, views3s: 100, completedViews: 10, clicks: 5, revenue: 50 }]);
    const findings = diagnoseAdLabMetrics(weak).join(" ");
    expect(findings).toContain("Hook");
    expect(findings).toContain("รายได้ยังต่ำกว่า");
  });

  it("uses brand context to create a ready-to-speak fallback script", () => {
    const brand: AdLabBrand = { id: "b1", name: "RClipper", product: "AI video", audience: "เจ้าของร้าน", promise: "แพลตฟอร์มตัดต่อคลิปด้วย AI ใช้ง่ายผ่านมือถือ เริ่มต้น 299 บาท/เดือน", createdAt: "2026-01-01" };
    const outline = generateAdLabScriptOutline(brand, {
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

  it("falls back to brand.promise (product details) when detailedContent is empty", () => {
    const brand: AdLabBrand = { id: "b2", name: "RClipper", product: "AI video", audience: "เจ้าของร้าน", promise: "แพลตฟอร์มตัดต่อคลิปด้วย AI ใช้ง่ายผ่านมือถือ เริ่มต้น 299 บาท/เดือน", createdAt: "2026-01-01" };
    const outline = generateAdLabScriptOutline(brand, {
      mainMessage: "มีเวลาคืนให้ธุรกิจ",
      detailedContent: "",
      presentationDirection: "storytelling",
      objective: "conversion",
      duration: "30",
    });
    expect(outline.painPointsOrIntroduction).toContain("แพลตฟอร์มตัดต่อคลิปด้วย AI");
  });

  it("advertisement sections contain newline-chunked lines", () => {
    const brand: AdLabBrand = { id: "b3", name: "RClipper", product: "AI video", audience: "เจ้าของร้าน", promise: "แพลตฟอร์ม AI", createdAt: "2026-01-01" };
    const outline = generateAdLabScriptOutline(brand, {
      mainMessage: "มีเวลาคืนให้ธุรกิจ",
      detailedContent: "ใช้ง่ายผ่านมือถือ",
      presentationDirection: "problem-solution",
      objective: "conversion",
      duration: "30",
      contentPurpose: "advertisement",
    });
    // Combined sections join their parts with \n
    expect(outline.sections[0].script).toContain("\n");
    expect(outline.sections[2].script).toContain("\n");
    // Closing is chunked
    expect(outline.closing).toContain("\n");
    // All existing field content is preserved
    expect(outline.hooks).toBeTruthy();
    expect(outline.solution).toContain("RClipper");
  });

  it("defaults to advertisement when contentPurpose is omitted", () => {
    const brand: AdLabBrand = { id: "b4", name: "RClipper", product: "AI video", audience: "เจ้าของร้าน", promise: "แพลตฟอร์ม AI", createdAt: "2026-01-01" };
    const outline = generateAdLabScriptOutline(brand, {
      mainMessage: "ลดเวลาตัดต่อ",
      detailedContent: "",
      presentationDirection: "problem-solution",
      objective: "conversion",
      duration: "30",
    });
    // Should produce advertisement-style hook (not first-person PB)
    expect(outline.mainHook).toContain("ลดเวลาตัดต่อ");
  });

  describe("personal_branding", () => {
    const brand: AdLabBrand = {
      id: "pb1", name: "ครูเอก", product: "คอร์สตัดต่อวิดีโอ", audience: "ช่างภาพหน้าใหม่",
      promise: "คอร์สออนไลน์ 12 ชั่วโมง ราคา 1,990 บาท", createdAt: "2026-01-01",
    };

    it("generates a first-person outline for story-experience", () => {
      const outline = generateAdLabScriptOutline(brand, {
        mainMessage: "ตัดต่อวิดีโอให้ขายได้",
        detailedContent: "ฉันตัดต่อมา 5 ปีก่อนจะสร้างคอร์สนี้",
        presentationDirection: "story-experience",
        objective: "authority",
        duration: "60",
        contentPurpose: "personal_branding",
      });
      expect(outline.sections).toHaveLength(4);
      // First-person voice somewhere in the outline
      const allText = [outline.mainHook, outline.hooks, outline.content, outline.solution].join(" ");
      expect(allText).toMatch(/ฉัน/);
    });

    it("uses authority soft CTA that includes 'ติดตาม'", () => {
      const outline = generateAdLabScriptOutline(brand, {
        mainMessage: "ตัดต่อวิดีโอให้ขายได้",
        detailedContent: "",
        presentationDirection: "story-experience",
        objective: "authority",
        duration: "60",
        contentPurpose: "personal_branding",
      });
      expect(outline.closing).toContain("ติดตาม");
      expect(outline.closing).not.toContain("ซื้อ");
      expect(outline.closing).not.toContain("เริ่มต้นกับ");
    });

    it("uses leads soft CTA that includes 'ทักมา'", () => {
      const outline = generateAdLabScriptOutline(brand, {
        mainMessage: "ตัดต่อวิดีโอให้ขายได้",
        detailedContent: "",
        presentationDirection: "tips-knowledge",
        objective: "leads",
        duration: "60",
        contentPurpose: "personal_branding",
      });
      expect(outline.closing).toContain("ทักมา");
    });

    it("uses engagement soft CTA that invites commenting", () => {
      const outline = generateAdLabScriptOutline(brand, {
        mainMessage: "ตัดต่อวิดีโอให้ขายได้",
        detailedContent: "",
        presentationDirection: "opinion",
        objective: "engagement",
        duration: "60",
        contentPurpose: "personal_branding",
      });
      expect(outline.closing).toContain("คอมเมนต์");
    });

    it("uses community CTA that mentions Bio/group", () => {
      const outline = generateAdLabScriptOutline(brand, {
        mainMessage: "ตัดต่อวิดีโอให้ขายได้",
        detailedContent: "",
        presentationDirection: "behind-the-scenes",
        objective: "community",
        duration: "60",
        contentPurpose: "personal_branding",
      });
      expect(outline.closing).toContain("กลุ่ม");
    });

    it("section scripts contain newline-chunked lines", () => {
      const outline = generateAdLabScriptOutline(brand, {
        mainMessage: "ตัดต่อวิดีโอให้ขายได้",
        detailedContent: "ฉันตัดต่อมา 5 ปี",
        presentationDirection: "story-experience",
        objective: "followers",
        duration: "60",
        contentPurpose: "personal_branding",
      });
      // Sections that combine two parts use \n
      expect(outline.sections[0].script).toContain("\n");
      expect(outline.sections[2].script).toContain("\n");
    });

    it("uses the brand name in the title", () => {
      const outline = generateAdLabScriptOutline(brand, {
        mainMessage: "เรียนตัดต่อให้เป็น",
        detailedContent: "",
        presentationDirection: "qa",
        objective: "authority",
        duration: "60",
        contentPurpose: "personal_branding",
      });
      expect(outline.title).toContain("ครูเอก");
    });

    it("falls back to brand.promise when detailedContent is empty", () => {
      const outline = generateAdLabScriptOutline(brand, {
        mainMessage: "เรียนตัดต่อให้เป็น",
        detailedContent: "",
        presentationDirection: "story-experience",
        objective: "authority",
        duration: "60",
        contentPurpose: "personal_branding",
      });
      expect(outline.painPointsOrIntroduction).toContain("คอร์สออนไลน์");
    });
  });
});

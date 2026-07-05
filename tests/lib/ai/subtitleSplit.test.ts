/**
 * Tests for splitSegmentsForDisplay — the subtitle-cue chunker that breaks long
 * aligned sentences into short, non-overlapping display cues while keeping the
 * languages synchronised and the timing contiguous within each sentence window.
 *
 * geminiSubtitlesService pulls in the Spaces/S3 client + config at module load,
 * so those are mocked to keep the import side-effect free.
 */

jest.mock("@/lib/spaces", () => ({ spacesClient: {} }));
jest.mock("@/config/aiTools", () => ({
  AI_CONFIG: { gemini: { textModel: "gemini-2.0-flash" } },
  requireGeminiApiKey: () => "test-key",
}));
jest.mock("@aws-sdk/client-s3", () => ({ GetObjectCommand: class {} }));

import {
  splitSegmentsForDisplay,
  generateAssSubtitles,
  type TimedSegment,
} from "@/lib/ai/geminiSubtitlesService";

const LONG_EN =
  "Thinly sliced pork, bouncy meatballs, and a super fragrant broth. " +
  "Mix both dipping sauces together for the perfect flavor, it is seriously delicious.";

describe("splitSegmentsForDisplay", () => {
  it("leaves short segments untouched", () => {
    const segs: TimedSegment[] = [
      { sentenceNumber: 1, textThai: "อร่อยมาก", textEnglish: "So tasty", textChinese: "很好吃", startSecond: 0, endSecond: 2 },
    ];
    expect(splitSegmentsForDisplay(segs, ["en", "zh"])).toEqual(segs);
  });

  it("splits a long sentence into multiple cues, each under the per-language limit", () => {
    const segs: TimedSegment[] = [
      { sentenceNumber: 1, textThai: "", textEnglish: LONG_EN, textChinese: "", startSecond: 4, endSecond: 12 },
    ];
    const out = splitSegmentsForDisplay(segs, ["en"]);
    expect(out.length).toBeGreaterThan(1);
    for (const cue of out) {
      expect(cue.textEnglish.length).toBeLessThanOrEqual(42);
    }
  });

  it("keeps the cue timings contiguous and inside the original window", () => {
    const segs: TimedSegment[] = [
      { sentenceNumber: 1, textThai: "", textEnglish: LONG_EN, textChinese: "", startSecond: 4, endSecond: 12 },
    ];
    const out = splitSegmentsForDisplay(segs, ["en"]);
    expect(out[0].startSecond).toBeCloseTo(4, 5);
    expect(out[out.length - 1].endSecond).toBeCloseTo(12, 5);
    for (let i = 1; i < out.length; i++) {
      // No gaps, no overlaps: each cue starts exactly where the previous ended.
      expect(out[i].startSecond).toBeCloseTo(out[i - 1].endSecond, 5);
      expect(out[i].endSecond).toBeGreaterThan(out[i].startSecond);
    }
  });

  it("splits every language into the SAME number of synced cues sharing time boundaries", () => {
    const segs: TimedSegment[] = [
      {
        sentenceNumber: 1,
        textThai: "เนื้อหมูสไลด์บางบางลูกชิ้นเด้งเด้งและน้ำซุปหอมกรุ่นผสมน้ำจิ้มสองอย่างเข้าด้วยกันอร่อยสุดๆ",
        textEnglish: LONG_EN,
        textChinese: "薄切猪肉弹牙肉丸还有香浓汤底把两种蘸酱混在一起味道绝了真的超级好吃",
        startSecond: 0,
        endSecond: 10,
      },
    ];
    const out = splitSegmentsForDisplay(segs, ["th", "en", "zh"]);
    expect(out.length).toBeGreaterThan(1);
    // Reassembling each language yields the original text (no dropped content).
    expect(out.map((c) => c.textEnglish).join(" ").replace(/\s+/g, " ").trim())
      .toBe(LONG_EN.replace(/\s+/g, " ").trim());
    expect(out.map((c) => c.textChinese).join("")).toBe(segs[0].textChinese);
    expect(out.map((c) => c.textThai).join("")).toBe(segs[0].textThai);
  });

  it("never exceeds the max cue cap for pathologically long input", () => {
    const huge = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const out = splitSegmentsForDisplay(
      [{ sentenceNumber: 1, textThai: "", textEnglish: huge, textChinese: "", startSecond: 0, endSecond: 30 }],
      ["en"]
    );
    expect(out.length).toBeLessThanOrEqual(6);
  });

  it("does not split when the time window is non-positive", () => {
    const segs: TimedSegment[] = [
      { sentenceNumber: 1, textThai: "", textEnglish: LONG_EN, textChinese: "", startSecond: 5, endSecond: 5 },
    ];
    expect(splitSegmentsForDisplay(segs, ["en"])).toEqual(segs);
  });
});

describe("generateAssSubtitles (with chunking)", () => {
  it("emits multiple Dialogue lines for a long sentence instead of one long cue", () => {
    const ass = generateAssSubtitles(
      [{ sentenceNumber: 1, textThai: "", textEnglish: LONG_EN, textChinese: "", startSecond: 0, endSecond: 10 }],
      ["en"]
    );
    const dialogueLines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogueLines.length).toBeGreaterThan(1);
  });
});

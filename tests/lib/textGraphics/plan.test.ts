import {
  fallbackTextGraphicItems,
  parseTextGraphicsPlan,
  planFingerprint,
  sanitizeTextGraphicItems,
  sceneWindows,
  toManifestTextGraphics,
  type TextGraphicsPlan,
} from "@/lib/textGraphics/plan";
import { TEXT_GRAPHIC_STYLES, TEXT_GRAPHIC_FONTS } from "@/config/textGraphicStyles";
import { deviceTextGraphicsSchema } from "@/lib/mobile/deviceRenderContract";

/**
 * The plan is what Claude writes and every renderer draws. These tests are
 * about the ways a model's answer could reach a phone in a shape it cannot
 * draw: overlapping items fighting for the top of the frame, text too long for
 * a card, times outside the video, a fifth badge.
 */

describe("sanitizeTextGraphicItems", () => {
  it("keeps known kinds, clamps times and trims text to its budget", () => {
    const items = sanitizeTextGraphicItems(
      [
        { kind: "hook", start: -1, end: 3.5, title: "MAGURO KAPPOU", sub: "ร้านอาหารญี่ปุ่น", kicker: "japanese restaurant" },
        { kind: "banner", start: 4, end: 6, title: "unknown kind" },
        { kind: "label", start: 5, end: 99, title: "ข้าวหน้าโอโทโร่ที่อร่อยที่สุดในย่านนี้แน่นอน", sub: "Otoro Rice Bowl" },
      ],
      20
    );
    expect(items.map((i) => i.kind)).toEqual(["hook", "label"]);
    expect(items[0].start).toBe(0);
    expect(items[1].end).toBe(20);
    expect(Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(items[1].title)).length)
      .toBeLessThanOrEqual(22);
  });

  it("never lets two items share the screen", () => {
    const items = sanitizeTextGraphicItems(
      [
        { kind: "label", start: 2, end: 6, title: "A" },
        { kind: "label", start: 5, end: 9, title: "B" },
        { kind: "label", start: 8.5, end: 9.2, title: "too short once moved" },
      ],
      30
    );
    expect(items).toHaveLength(2);
    expect(items[1].start).toBeGreaterThanOrEqual(items[0].end + 0.15 - 1e-9);
  });

  it("allows one hook, one CTA and at most three badges", () => {
    const labels = Array.from({ length: 6 }, (_, i) => ({
      kind: "label", start: 4 + i * 3, end: 6 + i * 3, title: `L${i}`, badge: "แนะนำ!",
    }));
    const items = sanitizeTextGraphicItems(
      [
        { kind: "hook", start: 0, end: 3, title: "H1" },
        { kind: "hook", start: 0.5, end: 3, title: "H2" },
        ...labels,
        { kind: "cta", start: 26, end: 30, title: "สั่งเลย!", brand: "Shop" },
        { kind: "cta", start: 27, end: 30, title: "again" },
      ],
      30
    );
    expect(items.filter((i) => i.kind === "hook")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "cta")).toHaveLength(1);
    expect(items.filter((i) => i.badge)).toHaveLength(3);
  });

  it("returns nothing for garbage", () => {
    expect(sanitizeTextGraphicItems("nope", 10)).toEqual([]);
    expect(sanitizeTextGraphicItems([{ kind: "label" }], 10)).toEqual([]);
    expect(sanitizeTextGraphicItems([{ kind: "label", start: 1, end: 3, title: "x" }], 0)).toEqual([]);
  });
});

describe("sceneWindows", () => {
  it("places scenes on the picture timeline, overlapping by the crossfade", () => {
    const windows = sceneWindows([{ seconds: 4 }, { seconds: 3 }, { seconds: 5 }], 0.2);
    expect(windows.map((w) => [w.start, w.end])).toEqual([
      [0, 4],
      [3.8, 6.8],
      [6.6, 11.6],
    ]);
  });
});

describe("planFingerprint", () => {
  const windows = sceneWindows([{ seconds: 4, firstAssetIndex: 0 }, { seconds: 3, firstAssetIndex: 1 }], 0.2);
  const base = { choice: "auto" as const, windows, timeline: [[0.6, 2, "สวัสดี"]], leadInSeconds: 0.6, brand: "Shop" };

  it("is stable for the same inputs", () => {
    expect(planFingerprint(base)).toBe(planFingerprint({ ...base }));
  });

  it("changes with the style, the edit, the voice and the music lead-in", () => {
    const f = planFingerprint(base);
    expect(planFingerprint({ ...base, choice: "street" })).not.toBe(f);
    expect(planFingerprint({ ...base, windows: sceneWindows([{ seconds: 5 }], 0.2) })).not.toBe(f);
    expect(planFingerprint({ ...base, timeline: [[0.6, 2.5, "สวัสดี"]] })).not.toBe(f);
    expect(planFingerprint({ ...base, leadInSeconds: 0 })).not.toBe(f);
  });
});

describe("fallbackTextGraphicItems", () => {
  it("opens on the business name and closes on a card that ends with the video", () => {
    const items = fallbackTextGraphicItems({
      durationSeconds: 30,
      brand: "MAGURO KAPPOU",
      hookLine: "มื้อญี่ปุ่นจัดเต็ม",
      ctaTitle: "แวะมาเลย!",
      place: "",
    });
    expect(items[0]).toMatchObject({ kind: "hook", title: "MAGURO KAPPOU", sub: "มื้อญี่ปุ่นจัดเต็ม" });
    expect(items[items.length - 1]).toMatchObject({ kind: "cta", end: 30, brand: "MAGURO KAPPOU" });
  });

  it("is empty for a video too short to carry it", () => {
    expect(fallbackTextGraphicItems({ durationSeconds: 2, brand: "x", hookLine: "", ctaTitle: "y", place: "" })).toEqual([]);
  });
});

describe("parse and resolve", () => {
  const plan: TextGraphicsPlan = {
    version: 1,
    choice: "auto",
    styleId: "street",
    items: sanitizeTextGraphicItems([{ kind: "label", start: 1, end: 4, title: "หมูปิ้ง", sub: "Grilled Pork" }], 10),
    source: "claude",
    fingerprint: "abc",
    durationSeconds: 10,
    createdAt: "2026-10-10T00:00:00.000Z",
  };

  it("round-trips through JSON", () => {
    expect(parseTextGraphicsPlan(JSON.stringify(plan))).toEqual(plan);
    expect(parseTextGraphicsPlan("{bad json")).toBeNull();
    expect(parseTextGraphicsPlan(JSON.stringify({ ...plan, styleId: "nope" }))).toBeNull();
  });

  it("resolves to a manifest block the contract accepts", () => {
    const resolved = toManifestTextGraphics(plan, "#06D6A0", "https://app.rclipper.com/");
    expect(resolved).not.toBeNull();
    // Street has its own accent; the palette's is only the fallback.
    expect(resolved!.accent).toBe(TEXT_GRAPHIC_STYLES.street.accent);
    expect(resolved!.fonts.map((f) => f.url)).toEqual(
      expect.arrayContaining(["https://app.rclipper.com/fonts/Kanit-ExtraBold.ttf"])
    );
    expect(() => deviceTextGraphicsSchema.parse(resolved)).not.toThrow();
  });

  it("uses the palette accent for a pack without its own", () => {
    const resolved = toManifestTextGraphics({ ...plan, styleId: "premium" }, "#06D6A0", "https://x.test");
    expect(resolved!.accent).toBe("#06D6A0");
  });

  it("is null when there is nothing to draw", () => {
    expect(toManifestTextGraphics(null, "#000000", "https://x.test")).toBeNull();
    expect(toManifestTextGraphics({ ...plan, items: [] }, "#000000", "https://x.test")).toBeNull();
  });

  it("every pack names fonts that exist", () => {
    for (const style of Object.values(TEXT_GRAPHIC_STYLES)) {
      for (const key of Object.values(style.fonts)) expect(TEXT_GRAPHIC_FONTS[key]).toBeDefined();
    }
  });
});

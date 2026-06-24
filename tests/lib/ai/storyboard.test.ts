import {
  buildFallbackStoryboard,
  ensureAllAssetsUsed,
  sanitizeStoryboard,
} from "@/lib/ai/storyboard";

describe("buildFallbackStoryboard", () => {
  it("returns a single empty scene when there are no assets", () => {
    const sb = buildFallbackStoryboard(0);
    expect(sb).toEqual([{ sceneNumber: 1, summary: "", assetIndexes: [] }]);
  });

  it("spreads assets one-per-scene up to the target", () => {
    const sb = buildFallbackStoryboard(3);
    expect(sb).toHaveLength(3);
    expect(sb.flatMap((s) => s.assetIndexes)).toEqual([0, 1, 2]);
    expect(sb.map((s) => s.sceneNumber)).toEqual([1, 2, 3]);
  });

  it("covers every asset with contiguous indexes when assets exceed scenes", () => {
    const sb = buildFallbackStoryboard(4); // default 3 scenes
    expect(sb.flatMap((s) => s.assetIndexes).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("never creates more scenes than assets", () => {
    const sb = buildFallbackStoryboard(2, 5);
    expect(sb).toHaveLength(2);
  });
});

describe("sanitizeStoryboard", () => {
  it("falls back when input is not an array", () => {
    expect(sanitizeStoryboard(null, 3)).toEqual(buildFallbackStoryboard(3));
    expect(sanitizeStoryboard("nope", 2)).toEqual(buildFallbackStoryboard(2));
  });

  it("drops out-of-range asset indexes and renumbers scenes", () => {
    const sb = sanitizeStoryboard(
      [
        { sceneNumber: 9, summary: "  ดูเมนู  ", assetIndexes: [0, 5, -1, 2] },
        { summary: "", assetIndexes: [1] },
      ],
      3
    );
    expect(sb).toHaveLength(2);
    expect(sb[0]).toEqual({ sceneNumber: 1, summary: "ดูเมนู", assetIndexes: [0, 2] });
    expect(sb[1]).toEqual({ sceneNumber: 2, summary: "", assetIndexes: [1] });
  });

  it("keeps a valid roughDurationHint", () => {
    const sb = sanitizeStoryboard([{ summary: "x", assetIndexes: [0], roughDurationHint: 4 }], 1);
    expect(sb[0].roughDurationHint).toBe(4);
  });

  it("falls back when every entry is empty", () => {
    const sb = sanitizeStoryboard([{ summary: "", assetIndexes: [] }], 2);
    // fallback already covers all assets; every index appears
    const used = new Set(sb.flatMap((s) => s.assetIndexes));
    expect(used).toEqual(new Set([0, 1]));
  });

  it("ensures every uploaded asset is used even if the AI references only the first", () => {
    // AI returned a single scene using only image 0, but 3 were uploaded.
    const sb = sanitizeStoryboard([{ summary: "ฉากเดียว", assetIndexes: [0] }], 3);
    const used = new Set(sb.flatMap((s) => s.assetIndexes));
    expect(used).toEqual(new Set([0, 1, 2]));
  });
});

describe("ensureAllAssetsUsed", () => {
  it("appends missing asset indexes balanced across scenes", () => {
    const scenes = [
      { sceneNumber: 1, summary: "a", assetIndexes: [0] },
      { sceneNumber: 2, summary: "b", assetIndexes: [] },
    ];
    const out = ensureAllAssetsUsed(scenes, 3);
    const used = new Set(out.flatMap((s) => s.assetIndexes));
    expect(used).toEqual(new Set([0, 1, 2]));
    // missing 1 and 2 go to the emptiest scenes for balance
    expect(out[1].assetIndexes.length).toBeGreaterThan(0);
  });

  it("is a no-op when all assets are already used", () => {
    const scenes = [{ sceneNumber: 1, summary: "a", assetIndexes: [0, 1] }];
    expect(ensureAllAssetsUsed(scenes, 2)).toBe(scenes);
  });

  it("does nothing when there are no assets", () => {
    const scenes = [{ sceneNumber: 1, summary: "", assetIndexes: [] }];
    expect(ensureAllAssetsUsed(scenes, 0)).toBe(scenes);
  });
});

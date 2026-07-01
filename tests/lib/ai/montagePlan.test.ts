import {
  allocateAssetDurations,
  buildSceneMontageAssets,
  inferMotionFromText,
  pickMotionForIndex,
  toRenderAssetSpecs,
} from "@/lib/ai/montagePlan";
import type { OrderedSourceAsset } from "@/lib/sourceAssets";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

function ordered(
  specs: { kind: "image" | "clip" }[]
): OrderedSourceAsset[] {
  return specs.map((s, index) => ({
    index,
    id: `asset-${index}`,
    url: `https://cdn.example.com/asset-${index}.${s.kind === "clip" ? "mp4" : "jpg"}`,
    thumbnailUrl: `https://cdn.example.com/asset-${index}-thumb.jpg`,
    kind: s.kind,
    fileName: `asset-${index}`,
  }));
}

function scene(partial: Partial<ScenePlan>): ScenePlan {
  return {
    sceneNumber: 1,
    durationSeconds: 6,
    visualDescriptionThai: "ฉาก",
    imageIndexes: [],
    ...partial,
  };
}

describe("allocateAssetDurations", () => {
  it("splits evenly across slots, frame-accurately (no remainder dumped on the last)", () => {
    expect(allocateAssetDurations(3, 9)).toEqual([3, 3, 3]);
    // 7s over 2 slots → 3.5s each (frame-aligned), not [3, 4].
    expect(allocateAssetDurations(2, 7)).toEqual([3.5, 3.5]);
  });

  it("keeps the sum equal to the total and aligns to the 30fps grid", () => {
    const out = allocateAssetDurations(4, 10);
    expect(out.reduce((s, d) => s + d, 0)).toBeCloseTo(10, 5);
    for (const d of out) {
      expect(Math.round(d * 30)).toBeCloseTo(d * 30, 9); // whole frames
      expect(d).toBeGreaterThan(0);
    }
  });

  it("never returns a zero/negative duration and handles bad totals", () => {
    expect(allocateAssetDurations(3, 0)).toEqual([1, 1, 1]);
    expect(allocateAssetDurations(2, -5)).toEqual([1, 1]);
    expect(allocateAssetDurations(0, 10)).toEqual([]);
  });
});

describe("pickMotionForIndex", () => {
  it("cycles still motions for variety (not ken_burns_in everywhere)", () => {
    expect(pickMotionForIndex(0, "image")).toBe("ken_burns_in");
    expect(pickMotionForIndex(1, "image")).toBe("pan_left");
    expect(pickMotionForIndex(2, "image")).toBe("ken_burns_out");
    expect(pickMotionForIndex(3, "image")).toBe("pan_right");
    expect(pickMotionForIndex(4, "image")).toBe("ken_burns_in"); // wraps
    // Neighbouring stills always differ.
    expect(pickMotionForIndex(0, "image")).not.toBe(pickMotionForIndex(1, "image"));
  });

  it("renders clips as-shot (static, no Ken Burns)", () => {
    expect(pickMotionForIndex(0, "clip")).toBe("static");
    expect(pickMotionForIndex(3, "clip")).toBe("static");
  });
});

describe("inferMotionFromText", () => {
  it("honours a described zoom out (Thai + English)", () => {
    expect(inferMotionFromText("กล้องค่อยๆ ถอยห่างออกไปเพื่อให้เห็นภาพรวมของร้าน")).toBe("ken_burns_out");
    expect(inferMotionFromText("the camera slowly zooms out to reveal the venue")).toBe("ken_burns_out");
  });

  it("honours a described zoom in to the signboard", () => {
    expect(inferMotionFromText("ซูมเข้าไปที่ป้ายร้าน")).toBe("ken_burns_in");
    expect(inferMotionFromText("push in / zoom in on the sign")).toBe("ken_burns_in");
  });

  it("honours explicit pan direction before generic zoom", () => {
    expect(inferMotionFromText("แพนซ้ายไปขวาช้าๆ")).toBe("pan_right");
    expect(inferMotionFromText("pan left across the dishes")).toBe("pan_left");
  });

  it("returns null when no camera move is described (caller uses the rotation)", () => {
    expect(inferMotionFromText("จานพาสต้าวางบนโต๊ะไม้")).toBeNull();
    expect(inferMotionFromText("")).toBeNull();
    expect(inferMotionFromText(undefined)).toBeNull();
  });
});

describe("buildSceneMontageAssets", () => {
  it("derives assets from imageIndexes, resolving kind from the ordered list", () => {
    const list = ordered([{ kind: "image" }, { kind: "clip" }, { kind: "image" }]);
    const assets = buildSceneMontageAssets(scene({ imageIndexes: [0, 1] }), list, 8);

    expect(assets.map((a) => a.assetIndex)).toEqual([0, 1]);
    expect(assets.map((a) => a.kind)).toEqual(["image", "clip"]);
    // Durations allocated across the two assets sum to the scene duration.
    expect(assets.reduce((s, a) => s + a.durationSeconds, 0)).toBe(8);
    // Every asset gets a positive duration and a valid default motion.
    for (const a of assets) {
      expect(a.durationSeconds).toBeGreaterThan(0);
      expect(typeof a.motion).toBe("string");
    }
  });

  it("falls back to all ordered assets when the scene selects none", () => {
    const list = ordered([{ kind: "image" }, { kind: "image" }]);
    const assets = buildSceneMontageAssets(scene({ imageIndexes: [] }), list, 4);
    expect(assets.map((a) => a.assetIndex)).toEqual([0, 1]);
  });

  it("drops out-of-range indexes and falls back to index 0 when none remain", () => {
    const list = ordered([{ kind: "image" }]);
    const assets = buildSceneMontageAssets(scene({ imageIndexes: [5, 9] }), list, 3);
    expect(assets.map((a) => a.assetIndex)).toEqual([0]);
    expect(assets[0].durationSeconds).toBe(3);
  });

  it("preserves an existing per-asset motion/trim choice and honors pinned durations", () => {
    const list = ordered([{ kind: "image" }, { kind: "clip" }]);
    const s = scene({
      durationSeconds: 10,
      assets: [
        { assetIndex: 0, kind: "image", motion: "pan_left", durationSeconds: 4 },
        {
          assetIndex: 1,
          kind: "clip",
          motion: "static",
          durationSeconds: 0, // unpinned -> allocated
          trimStartSeconds: 2,
          trimEndSeconds: 5,
        },
      ],
    });
    const assets = buildSceneMontageAssets(s, list, 10);

    expect(assets[0].motion).toBe("pan_left");
    expect(assets[0].durationSeconds).toBe(4); // pinned, preserved
    // Remaining 6s allocated to the unpinned clip; trim preserved.
    expect(assets[1].durationSeconds).toBe(6);
    expect(assets[1].trimStartSeconds).toBe(2);
    expect(assets[1].trimEndSeconds).toBe(5);
  });
});

describe("toRenderAssetSpecs — cross-pipeline index alignment", () => {
  it("resolves each asset index to the SAME url in the ordered list", () => {
    const list = ordered([{ kind: "image" }, { kind: "clip" }, { kind: "image" }]);
    const assets = buildSceneMontageAssets(scene({ imageIndexes: [2, 1] }), list, 6);
    const specs = toRenderAssetSpecs(assets, list);

    expect(specs.map((s) => s.url)).toEqual([list[2].url, list[1].url]);
    // The clip keeps its clip kind through the whole resolution.
    expect(specs[1].kind).toBe("clip");
  });

  it("drops invalid indexes and falls back to the first ordered asset", () => {
    const list = ordered([{ kind: "image" }]);
    const specs = toRenderAssetSpecs(
      [{ assetIndex: 7, kind: "image", motion: "static", durationSeconds: 3 }],
      list
    );
    expect(specs).toHaveLength(1);
    expect(specs[0].url).toBe(list[0].url);
  });
});

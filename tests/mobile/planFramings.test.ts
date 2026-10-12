import { mergeShapeFramings } from "@/lib/mobile/planFramings";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

const plan = [
  {
    sceneNumber: 1,
    durationSeconds: 4,
    visualDescriptionThai: "a",
    imageIndexes: [0, 1],
    assets: [
      { assetIndex: 0, kind: "clip", motion: "static", durationSeconds: 2, focusX: 0.5, focusY: 0.5, frameZoom: 1 },
      { assetIndex: 1, kind: "image", motion: "zoom_in", durationSeconds: 2, focusX: 0.5, focusY: 0.5, frameZoom: 1 },
    ],
  },
  {
    sceneNumber: 2,
    durationSeconds: 2,
    visualDescriptionThai: "b",
    imageIndexes: [2],
    assets: [{ assetIndex: 2, kind: "image", motion: "static", durationSeconds: 2, focusX: 0.5, focusY: 0.5 }],
  },
] as unknown as ScenePlan[];

const framing = (y: number) => ({ "16:9": { focusX: 0.5, focusY: y, frameZoom: 0.4 }, "7:3": { focusX: 0, focusY: 0, frameZoom: 0 } });

describe("mergeShapeFramings", () => {
  it("adds each shot's per-shape framing and touches nothing else", () => {
    const { plan: merged, changed } = mergeShapeFramings(plan, [
      { assets: [{ assetIndex: 0, framings: framing(0.8) }, { assetIndex: 1, framings: framing(0.3) }] },
      { assets: [{ assetIndex: 2, framings: framing(0.6), aiFraming: { subject: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 } } }] },
    ]);
    expect(changed).toBe(3);
    const first = merged[0].assets![0];
    expect(first.framings).toEqual({ "16:9": { focusX: 0.5, focusY: 0.8, frameZoom: 0.4 } });
    expect(first.durationSeconds).toBe(2);
    expect(first.frameZoom).toBe(1);
    expect(merged[1].assets![0].aiFraming).toEqual({
      subject: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 },
      keep: null,
    });
  });

  it("matches the whole sequence even when the studio grouped scenes differently", () => {
    const { changed, plan: merged } = mergeShapeFramings(plan, [
      { assets: [{ assetIndex: 0, framings: framing(0.1) }] },
      { assets: [{ assetIndex: 1, framings: framing(0.2) }, { assetIndex: 2, framings: framing(0.9) }] },
    ]);
    expect(changed).toBe(3);
    expect(merged[1].assets![0].framings?.["16:9"]?.focusY).toBe(0.9);
  });

  it("leaves a shot it cannot vouch for alone", () => {
    const { changed, plan: merged } = mergeShapeFramings(plan, [
      { assets: [{ assetIndex: 5, framings: framing(0.1) }, { assetIndex: 1, framings: framing(0.2) }] },
    ]);
    expect(changed).toBe(1);
    expect(merged[0].assets![0].framings).toBeUndefined();
    expect(merged[0].assets![1].framings?.["16:9"]?.focusY).toBe(0.2);
  });

  it("ignores junk", () => {
    expect(mergeShapeFramings(plan, "nope").changed).toBe(0);
    expect(mergeShapeFramings(plan, [{ assets: [null, 4] }]).changed).toBe(0);
  });
});

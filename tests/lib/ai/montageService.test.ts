import { buildSceneInputProps, RenderSceneParams } from "@/lib/ai/montageService";
import type { MontageAssetSpec } from "@/config/montage";

function asset(overrides: Partial<MontageAssetSpec>): MontageAssetSpec {
  return {
    url: "https://cdn.example/img.jpg",
    kind: "image",
    motion: "ken_burns_in",
    durationSeconds: 3,
    ...overrides,
  };
}

function params(overrides: Partial<RenderSceneParams>): RenderSceneParams {
  return {
    ratio: "9:16",
    durationSeconds: 6,
    assets: [asset({})],
    transition: "fade",
    outputStorageKey: "scenes/test.mp4",
    ...overrides,
  };
}

describe("montageService.buildSceneInputProps", () => {
  it("passes ratio and duration through", () => {
    const props = buildSceneInputProps(params({ ratio: "16:9", durationSeconds: 12 }));
    expect(props.ratio).toBe("16:9");
    expect(props.durationSeconds).toBe(12);
  });

  it("falls back to a positive duration when given <= 0", () => {
    const props = buildSceneInputProps(
      params({ durationSeconds: 0, assets: [asset({}), asset({})] })
    );
    expect(props.durationSeconds).toBeGreaterThan(0);
    expect(props.durationSeconds).toBe(2); // max(1, assets.length)
  });

  it("defaults an invalid transition to fade", () => {
    const props = buildSceneInputProps(
      params({ transition: "spin" as unknown as RenderSceneParams["transition"] })
    );
    expect(props.transition).toBe("fade");
  });

  it("defaults an invalid motion preset to ken_burns_in", () => {
    const props = buildSceneInputProps(
      params({ assets: [asset({ motion: "barrel_roll" as unknown as MontageAssetSpec["motion"] })] })
    );
    expect(props.assets[0].motion).toBe("ken_burns_in");
  });

  it("coerces unknown asset kinds to image", () => {
    const props = buildSceneInputProps(
      params({ assets: [asset({ kind: "gif" as unknown as MontageAssetSpec["kind"] })] })
    );
    expect(props.assets[0].kind).toBe("image");
  });

  it("keeps a valid clip trim window", () => {
    const props = buildSceneInputProps(
      params({ assets: [asset({ kind: "clip", trimStartSeconds: 2, trimEndSeconds: 7 })] })
    );
    expect(props.assets[0].kind).toBe("clip");
    expect(props.assets[0].trimStartSeconds).toBe(2);
    expect(props.assets[0].trimEndSeconds).toBe(7);
  });

  it("drops an invalid clip trim window (end <= start)", () => {
    const props = buildSceneInputProps(
      params({ assets: [asset({ kind: "clip", trimStartSeconds: 5, trimEndSeconds: 3 })] })
    );
    expect(props.assets[0].trimStartSeconds).toBe(5);
    expect(props.assets[0].trimEndSeconds).toBeUndefined();
  });

  it("ignores trim values on images", () => {
    const props = buildSceneInputProps(
      params({ assets: [asset({ kind: "image", trimStartSeconds: 2, trimEndSeconds: 7 })] })
    );
    expect(props.assets[0].trimStartSeconds).toBeUndefined();
    expect(props.assets[0].trimEndSeconds).toBeUndefined();
  });

  it("clamps focus coordinates to 0..1 and drops non-finite ones", () => {
    const props = buildSceneInputProps(
      params({ assets: [asset({ focusX: 1.8, focusY: NaN })] })
    );
    expect(props.assets[0].focusX).toBe(1);
    expect(props.assets[0].focusY).toBeUndefined();
  });
});

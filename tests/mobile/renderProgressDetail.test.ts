import {
  describeRenderPosition,
  formatClock,
  planFromManifest,
} from "@/lib/mobile/renderProgressDetail";
import type { DeviceRenderManifest } from "@/lib/mobile/deviceRenderContract";

function manifest(stage: "montage" | "master" | "final", buildFromSources = false) {
  return {
    stage,
    buildFromSources,
    template: { id: "editorial" },
    voiceUrl: stage === "montage" ? null : "https://example.com/voice.mp3",
    captions: [
      { startSeconds: 0.6, endSeconds: 4, textThai: "a", textEnglish: "", textChinese: "" },
      { startSeconds: 4, endSeconds: 9, textThai: "b", textEnglish: "", textChinese: "" },
    ],
    sources: [
      { assetId: "p", kind: "image", url: "https://example.com/p.jpg" },
      { assetId: "c", kind: "clip", localId: "local-c" },
    ],
    scenes: [
      {
        sceneNumber: 0,
        assets: [
          { sourceAssetId: "p", durationSeconds: 4, motion: "ken_burns_in" },
          {
            sourceAssetId: "c",
            durationSeconds: 5,
            motion: "static",
            trimStartSeconds: 2,
            trimEndSeconds: 7,
          },
        ],
      },
      { sceneNumber: 1, assets: [{ sourceAssetId: "p", durationSeconds: 3, motion: "static" }] },
    ],
  } as unknown as DeviceRenderManifest;
}

describe("render progress detail", () => {
  it("lays out every shot on the timeline", () => {
    const plan = planFromManifest(manifest("montage"), new Map([["local-c", "IMG_1234.MOV"]]));
    expect(plan.pictureSeconds).toBe(12);
    expect(plan.shots.map((shot) => [shot.start, shot.end])).toEqual([
      [0, 4],
      [4, 9],
      [9, 12],
    ]);
    expect(plan.shots[1].name).toBe("IMG_1234.MOV");
    expect(plan.shots[0].name).toBe("photo 1");
    expect(plan.shots[2].name).toBe("photo 1");
  });

  it("names the scene, shot and trimmed clip the encode is on", () => {
    const plan = planFromManifest(manifest("montage"), new Map([["local-c", "IMG_1234.MOV"]]));
    // 15 % + half of the 80 % window = 6 s into a 12 s picture → the clip.
    const line = describeRenderPosition(plan, 55);
    expect(line).toContain("Scene 1 of 2");
    expect(line).toContain("shot 2 of 3");
    expect(line).toContain("clip IMG_1234.MOV (0:02–0:07)");
    expect(line).toContain("0:06 of 0:12");
  });

  it("says what happens before and after the encode", () => {
    const plan = planFromManifest(manifest("montage"));
    expect(describeRenderPosition(plan, 5)).toMatch(/Opening your photos and clips/);
    expect(describeRenderPosition(planFromManifest(manifest("master")), 5)).toMatch(/voice-over/);
    expect(describeRenderPosition(plan, 97)).toMatch(/cover picture/);
  });

  it("counts captions and names the look for the final part", () => {
    const plan = planFromManifest(manifest("final"));
    const line = describeRenderPosition(plan, 15 + 80 * (5 / 12));
    expect(line).toContain("Editorial look · caption 2 of 2");
    // A final made from the master draws no shots.
    expect(line).not.toContain("Scene");
  });

  it("names shots in a final made from the originals", () => {
    const plan = planFromManifest(manifest("final", true));
    expect(describeRenderPosition(plan, 20)).toContain("Scene 1 of 2 · shot 1 of 3 — photo");
  });

  it("formats a clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65.9)).toBe("1:05");
  });
});

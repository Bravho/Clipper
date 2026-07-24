import { applyApprovedStoryboardSelections } from "@/lib/ai/montagePlan";
import type { ScenePlan, StoryboardScene } from "@/domain/models/VideoGenerationJob";

describe("applyApprovedStoryboardSelections", () => {
  it("keeps the requester's exact scene order and material selections", () => {
    const generated: ScenePlan[] = [
      {
        sceneNumber: 1,
        durationSeconds: 5,
        visualDescriptionThai: "คำอธิบายจาก AI",
        imageIndexes: [2],
        assets: [
          { assetIndex: 2, kind: "image", motion: "static", durationSeconds: 5 },
        ],
      },
      {
        sceneNumber: 2,
        durationSeconds: 7,
        visualDescriptionThai: "ฉากที่ AI สลับมา",
        imageIndexes: [0],
      },
    ];
    const approved: StoryboardScene[] = [
      { sceneNumber: 1, summary: "สินค้า", assetIndexes: [1] },
      { sceneNumber: 2, summary: "ร้าน", assetIndexes: [2, 0] },
      { sceneNumber: 3, summary: "ปิดท้าย", assetIndexes: [1, 2] },
    ];

    const result = applyApprovedStoryboardSelections(generated, approved);

    expect(result).toHaveLength(3);
    expect(result.map((scene) => scene.sceneNumber)).toEqual([1, 2, 3]);
    expect(result.map((scene) => scene.imageIndexes)).toEqual([[1], [2, 0], [1, 2]]);
    expect(result.every((scene) => scene.assets === undefined)).toBe(true);
    expect(result[0].visualDescriptionThai).toBe("คำอธิบายจาก AI");
    expect(result[2].visualDescriptionThai).toBe("ปิดท้าย");
  });

  it("leaves legacy generation unchanged when no storyboard was approved", () => {
    const generated: ScenePlan[] = [
      {
        sceneNumber: 1,
        durationSeconds: 5,
        visualDescriptionThai: "ฉากเดิม",
        imageIndexes: [0],
      },
    ];
    expect(applyApprovedStoryboardSelections(generated, null)).toBe(generated);
  });
});

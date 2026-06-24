import { sanitizeSceneDescription, sanitizeScenePlanDescriptions } from "@/lib/ai/scenePlanSanitizer";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

describe("scenePlanSanitizer", () => {
  it("removes file names, URLs, storage paths, and image-number references", () => {
    expect(
      sanitizeSceneDescription(
        "Use image 1 from menu-front.jpg and tmp/user/date/request/raw-food.png: close-up of the bright plated dish."
      )
    ).toBe("Use source visual from and: close-up of the bright plated dish.");
  });

  it("sanitizes scene plan descriptions while preserving the legacy fallback", () => {
    const scenePlan: ScenePlan[] = [
      {
        sceneNumber: 1,
        durationSeconds: 5,
        visualDescriptionThai: "hero-shot.jpg",
        visualDescription: "Warm close-up of a ceramic bowl on a wooden table.",
        imageIndexes: [0],
      },
    ];

    expect(sanitizeScenePlanDescriptions(scenePlan)[0]).toMatchObject({
      visualDescriptionThai: "Warm close-up of a ceramic bowl on a wooden table.",
      visualDescription: "Warm close-up of a ceramic bowl on a wooden table.",
    });
  });

  it("removes instructions to generate text overlays in the video", () => {
    expect(
      sanitizeSceneDescription(
        "Slow push-in on the dessert, add text overlay 'Fresh today', then show glossy sauce movement."
      )
    ).toBe("Slow push-in on the dessert then show glossy sauce movement.");
  });

  it("removes Thai instructions to generate on-screen words", () => {
    expect(
      sanitizeSceneDescription(
        "กล้องแพนผ่านจานอาหาร ใส่ข้อความบนจอคำว่า สดใหม่ทุกวัน แล้วซูมให้เห็นไอน้ำ"
      )
    ).toBe("กล้องแพนผ่านจานอาหาร แล้วซูมให้เห็นไอน้ำ");
  });

  it("forces multi-image morphing scenes to 8 seconds and notes the rule in the scene title", () => {
    const scenePlan: ScenePlan[] = [
      {
        sceneNumber: 1,
        durationSeconds: 6,
        visualDescriptionThai: "Smooth transition from plated noodles to the finished table setup.",
        imageIndexes: [0, 1],
      },
    ];

    expect(sanitizeScenePlanDescriptions(scenePlan)[0]).toMatchObject({
      imageIndexes: [0, 1],
      durationSeconds: 8,
      visualDescriptionThai:
        "Morphing scene (8 seconds): Smooth transition from plated noodles to the finished table setup.",
    });
  });

  it("limits scene image selections to two images", () => {
    const scenePlan: ScenePlan[] = [
      {
        sceneNumber: 1,
        durationSeconds: 6,
        visualDescriptionThai: "Move across the product table.",
        imageIndexes: [0, 1, 2],
      },
    ];

    expect(sanitizeScenePlanDescriptions(scenePlan)[0].imageIndexes).toEqual([0, 1]);
  });
});

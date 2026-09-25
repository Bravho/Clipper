import {
  scenePlanFromScenes,
  scenesFromScenePlan,
  type EditorDocument,
  type EditorSource,
} from "@/features/device-render/editorState";

/**
 * A reopened studio rebuilds its timeline from the plan production was started
 * with, so "Regenerate the video" remakes the SAME edit — trims, focus, zoom,
 * camera moves and scene order — not a default one.
 */

function source(id: string, kind: "image" | "clip"): EditorSource {
  return {
    id,
    kind,
    file: new File([""], `${id}.${kind === "clip" ? "mp4" : "jpg"}`),
    previewUrl: `blob:${id}`,
    posterUrl: `blob:${id}-poster`,
    durationSeconds: kind === "clip" ? 10 : null,
    fileName: id,
  };
}

describe("scenesFromScenePlan", () => {
  const sources = [source("photo", "image"), source("clip", "clip")];
  const document = {
    ratio: "16:9",
    sources,
    scenes: [
      {
        id: "s1",
        transitionIn: "cut",
        summary: "The drink",
        shots: [
          {
            id: "a",
            sourceId: "clip",
            durationSeconds: 3,
            motion: "static",
            trimStartSeconds: 2,
            trimEndSeconds: 5,
            focusX: 0.4,
            focusY: 0.8,
            frameZoom: 0.3,
          },
        ],
      },
      {
        id: "s2",
        transitionIn: "slide",
        summary: "The shop",
        shots: [
          {
            id: "b",
            sourceId: "photo",
            durationSeconds: 4,
            motion: "pan_left",
            trimStartSeconds: 0,
            trimEndSeconds: null,
            focusX: 0.5,
            focusY: 0.5,
            frameZoom: null,
          },
        ],
      },
    ],
  } as unknown as EditorDocument;

  it("round-trips the edit the video was made with", () => {
    const indexOf = (id: string) => sources.findIndex((entry) => entry.id === id);
    const plan = scenePlanFromScenes(document, indexOf);
    const scenes = scenesFromScenePlan(plan, (index) => sources[index]);

    expect(scenes.map((scene) => scene.summary)).toEqual(["The drink", "The shop"]);
    expect(scenes[0].transitionIn).toBe("cut");
    expect(scenes[1].transitionIn).toBe("slide");
    expect(scenes[0].shots[0]).toMatchObject({
      sourceId: "clip",
      trimStartSeconds: 2,
      trimEndSeconds: 5,
      focusX: 0.4,
      focusY: 0.8,
      frameZoom: 0.3,
    });
    expect(scenes[1].shots[0]).toMatchObject({ sourceId: "photo", motion: "pan_left", durationSeconds: 4 });
  });

  it("leaves out material that is no longer on the phone", () => {
    const indexOf = (id: string) => sources.findIndex((entry) => entry.id === id);
    const plan = scenePlanFromScenes(document, indexOf);
    const scenes = scenesFromScenePlan(plan, (index) => (index === 0 ? sources[0] : undefined));
    expect(scenes).toHaveLength(1);
    expect(scenes[0].shots[0].sourceId).toBe("photo");
    // The first remaining scene opens the video.
    expect(scenes[0].transitionIn).toBe("cut");
  });
});

describe("one material per scene", () => {
  it("splits a scene holding several pieces of material, keeping order and description", () => {
    const { oneMaterialPerScene } = jest.requireActual("@/features/device-render/editorState");
    const shot = (id: string, sourceId: string) => ({
      id,
      sourceId,
      durationSeconds: 3,
      motion: "static",
      trimStartSeconds: 0,
      trimEndSeconds: null,
      focusX: 0.5,
      focusY: 0.5,
    });
    const scenes = oneMaterialPerScene([
      { id: "a", transitionIn: "cut", summary: "Opening", shots: [shot("1", "x"), shot("2", "y")] },
      { id: "b", transitionIn: "slide", summary: "Close", shots: [shot("3", "z")] },
    ]);
    expect(scenes.map((scene: { shots: { sourceId: string }[] }) => scene.shots.map((s) => s.sourceId))).toEqual([
      ["x"],
      ["y"],
      ["z"],
    ]);
    expect(scenes.map((scene: { summary: string }) => scene.summary)).toEqual(["Opening", "Opening", "Close"]);
    expect(scenes[0].id).toBe("a");
    expect(scenes[1].transitionIn).toBe("fade");
    expect(scenes[2].transitionIn).toBe("slide");
  });

  it("arranges picked material one scene each", () => {
    const { autoArrange } = jest.requireActual("@/features/device-render/editorState");
    const scenes = autoArrange([source("p", "image"), source("c", "clip")]);
    expect(scenes).toHaveLength(2);
    expect(scenes.every((scene: { shots: unknown[] }) => scene.shots.length === 1)).toBe(true);
  });
});

describe("studio video length", () => {
  it("allows up to 90 seconds for the studio only", () => {
    const {
      clipRequestFormSchema,
      studioClipRequestFormSchema,
    } = jest.requireActual("@/features/requests/validation/clipRequestSchema");
    const shape = (durationSeconds: number) => ({
      title: "A clip title",
      description: "A description long enough to pass the form's own minimum length check.",
      placeName: "Pho 54",
      latitude: 13.75,
      longitude: 100.5,
      targetPlatforms: ["tiktok"],
      durationSeconds,
    });
    expect(studioClipRequestFormSchema.safeParse(shape(90)).success).toBe(true);
    expect(studioClipRequestFormSchema.safeParse(shape(91)).success).toBe(false);
    expect(clipRequestFormSchema.safeParse(shape(31)).success).toBe(false);
  });
});

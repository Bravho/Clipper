import {
  briefProblems,
  canRequestStoryboard,
  emptyDocument,
  retimeScenes,
  scenePlanFromScenes,
  scenesFromStoryboard,
  scenesPlaySeconds,
  shotPlaySeconds,
  storyboardFromScenes,
  submissionProblems,
  type EditorDocument,
  type EditorScene,
  type EditorSource,
} from "@/features/device-render/editorState";
import { Platform } from "@/domain/enums/Platform";

/**
 * The phone studio's pure decisions: whether a brief is good enough to open a
 * real request with, and what a storyboard turns into once it is applied.
 *
 * These are the parts that decide whether a person's approved plan becomes the
 * timeline they approved, so they are tested here rather than only on a device.
 * Anything that touches a canvas or a file lives in the browser and is not
 * exercised by this suite.
 */

function source(id: string, kind: "image" | "clip", durationSeconds: number | null): EditorSource {
  return {
    id,
    kind,
    // The file is never read by the functions under test; only its identity
    // matters, so a one-byte stand-in keeps the suite free of fixtures.
    file: { name: `${id}.bin`, type: kind === "clip" ? "video/mp4" : "image/jpeg" } as File,
    previewUrl: `blob:${id}`,
    posterUrl: `blob:${id}-poster`,
    durationSeconds,
    fileName: `${id}.bin`,
  };
}

function documentWith(sources: EditorSource[], targetSeconds: number): EditorDocument {
  const base = emptyDocument();
  return { ...base, sources, brief: { ...base.brief, targetSeconds } };
}

describe("briefProblems", () => {
  it("accepts a brief that the request schema would accept", () => {
    const brief = {
      ...emptyDocument().brief,
      clipName: "Summer promotion",
      placeName: "Pho 54",
      details: "A noodle shop on the corner, open late, famous for its broth.",
    };
    expect(briefProblems(brief)).toEqual([]);
  });

  it("names every missing field rather than stopping at the first", () => {
    const problems = briefProblems({ ...emptyDocument().brief, platforms: [] });
    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).toContain("name");
    expect(problems.join(" ")).toContain("20 characters");
  });

  it("rejects a length the pipeline will not accept", () => {
    const brief = {
      ...emptyDocument().brief,
      clipName: "Name here",
      placeName: "Pho 54",
      details: "Twenty characters of description, at least, to clear the minimum.",
      // The studio allows up to 90 seconds (the phone renders it); past that
      // is refused.
      targetSeconds: 91,
    };
    expect(briefProblems(brief).join(" ")).toContain("Video length");
    expect(briefProblems({ ...brief, targetSeconds: 90 }).join(" ")).not.toContain("Video length");
  });

  it("starts on TikTok — the studio does not offer Travy for now", () => {
    expect(emptyDocument().brief.platforms).toEqual([Platform.TikTok]);
  });
});

describe("canRequestStoryboard", () => {
  it("refuses with no material, however complete the words are", () => {
    const base = emptyDocument();
    const withWords: EditorDocument = {
      ...base,
      brief: { ...base.brief, placeName: "Pho 54", details: "Late-night noodles." },
    };
    expect(canRequestStoryboard(withWords)).toBe(false);
  });

  it("is happier than briefProblems: no map pin is needed to plan", () => {
    const document = documentWith([source("a", "image", null)], 15);
    document.brief.placeName = "Pho 54";
    document.brief.details = "Late-night noodles.";
    expect(canRequestStoryboard(document)).toBe(true);
    expect(briefProblems(document.brief).length).toBeGreaterThan(0);
  });
});

describe("retimeScenes", () => {
  const scenes: EditorScene[] = [
    {
      id: "s1",
      transitionIn: "cut",
      summary: "",
      shots: [
        {
          id: "sh1",
          sourceId: "a",
          durationSeconds: 3,
          motion: "static",
          trimStartSeconds: 0,
          trimEndSeconds: 3,
          focusX: 0.5,
          focusY: 0.5,
        },
        {
          id: "sh2",
          sourceId: "b",
          durationSeconds: 3,
          motion: "ken_burns_in",
          trimStartSeconds: 0,
          trimEndSeconds: null,
          focusX: 0.5,
          focusY: 0.5,
        },
      ],
    },
  ];

  it("shares the target length out evenly", () => {
    const retimed = retimeScenes(scenes, 15);
    expect(retimed[0].shots.map((shot) => shot.durationSeconds)).toEqual([7.5, 7.5]);
  });

  it("moves a clip's window with its slot, so the trim still matches", () => {
    const retimed = retimeScenes(scenes, 10);
    expect(retimed[0].shots[0].trimEndSeconds).toBe(5);
    // A still has no window to move.
    expect(retimed[0].shots[1].trimEndSeconds).toBeNull();
  });

  it("never shortens a shot below the point where it reads as a flicker", () => {
    const retimed = retimeScenes(scenes, 0.4);
    for (const shot of retimed[0].shots) {
      expect(shot.durationSeconds).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("leaves an empty timeline alone instead of dividing by zero", () => {
    expect(retimeScenes([], 15)).toEqual([]);
  });
});

describe("scenesFromStoryboard", () => {
  const document = documentWith(
    [source("a", "image", null), source("b", "clip", 12), source("c", "image", null)],
    12
  );

  it("maps asset indexes onto the material they address", () => {
    const scenes = scenesFromStoryboard(document, [
      { sceneNumber: 1, summary: "The shop front", assetIndexes: [0] },
      { sceneNumber: 2, summary: "The broth", assetIndexes: [1, 2] },
    ]);
    // One photo or clip per scene: the second storyboard scene's two pieces
    // become two scenes, in order, sharing its sentence.
    expect(scenes.map((scene) => scene.summary)).toEqual([
      "The shop front",
      "The broth",
      "The broth",
    ]);
    expect(scenes.map((scene) => scene.shots.map((shot) => shot.sourceId))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("opens on a cut and dissolves into everything after it", () => {
    const scenes = scenesFromStoryboard(document, [
      { sceneNumber: 1, summary: "", assetIndexes: [0] },
      { sceneNumber: 2, summary: "", assetIndexes: [1] },
    ]);
    expect(scenes[0].transitionIn).toBe("cut");
    expect(scenes[1].transitionIn).toBe("fade");
  });

  it("drops a scene with nothing in it rather than leaving a row to tidy up", () => {
    const scenes = scenesFromStoryboard(document, [
      { sceneNumber: 1, summary: "Empty", assetIndexes: [] },
      { sceneNumber: 2, summary: "Real", assetIndexes: [0] },
    ]);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].summary).toBe("Real");
  });

  it("ignores an index that addresses material that is not there", () => {
    const scenes = scenesFromStoryboard(document, [
      { sceneNumber: 1, summary: "", assetIndexes: [0, 99] },
    ]);
    expect(scenes[0].shots).toHaveLength(1);
  });

  it("never widens a clip's window past the footage that exists", () => {
    const short = documentWith([source("a", "clip", 1.6), source("b", "image", null)], 20);
    const scenes = scenesFromStoryboard(short, [
      { sceneNumber: 1, summary: "", assetIndexes: [0, 1] },
    ]);
    const clipShot = scenes[0].shots[0];
    // Ten seconds on screen, 1.6s of footage: the window stops at the end of
    // the file and the renderer slows the clip to fill the rest.
    expect(clipShot.durationSeconds).toBe(10);
    expect(clipShot.trimEndSeconds).toBe(1.6);
  });

  it("comes out at the length the brief asked for", () => {
    const scenes = scenesFromStoryboard(document, [
      { sceneNumber: 1, summary: "", assetIndexes: [0, 1] },
      { sceneNumber: 2, summary: "", assetIndexes: [2] },
    ]);
    const total = scenes.reduce(
      (sum, scene) => sum + scene.shots.reduce((inner, shot) => inner + shot.durationSeconds, 0),
      0
    );
    expect(total).toBeCloseTo(12, 5);
  });

  it("gives a clip a window no longer than the slot it is on screen for", () => {
    const scenes = scenesFromStoryboard(document, [
      { sceneNumber: 1, summary: "", assetIndexes: [1] },
    ]);
    const shot = scenes[0].shots[0];
    expect(shot.trimEndSeconds).toBe(shot.durationSeconds);
  });
});

describe("scenesFromStoryboard with the submitted material order", () => {
  it("resolves indexes through the order the server holds, not the grid's", () => {
    const document = documentWith([source("a", "image", null), source("b", "image", null)], 10);
    // The server's list is [b, a]: asset index 0 means b.
    const order = ["b", "a"];
    const scenes = scenesFromStoryboard(
      document,
      [{ sceneNumber: 1, summary: "", assetIndexes: [0] }],
      (assetIndex) => document.sources.find((entry) => entry.id === order[assetIndex])
    );
    expect(scenes[0].shots[0].sourceId).toBe("b");
  });
});

describe("storyboardFromScenes", () => {
  const document = scenesFromStoryboard(
    documentWith([source("a", "image", null), source("b", "clip", 8), source("c", "image", null)], 12),
    [
      { sceneNumber: 1, summary: "Front", assetIndexes: [2] },
      { sceneNumber: 2, summary: "Food", assetIndexes: [0, 1] },
    ]
  );
  const order = ["a", "b", "c"];
  const indexOf = (sourceId: string) => order.indexOf(sourceId);

  it("round-trips a storyboard, keeping the scene order and sentences", () => {
    expect(storyboardFromScenes(document, indexOf)).toEqual([
      { sceneNumber: 1, summary: "Front", assetIndexes: [2] },
      { sceneNumber: 2, summary: "Food", assetIndexes: [0] },
      { sceneNumber: 3, summary: "Food", assetIndexes: [1] },
    ]);
  });

  it("names each piece of material once, however many shots use it", () => {
    const doubled = [{ ...document[0], shots: [...document[0].shots, ...document[0].shots] }];
    expect(storyboardFromScenes(doubled, indexOf)[0].assetIndexes).toEqual([2]);
  });

  it("leaves out scenes with nothing in them and renumbers the rest", () => {
    const withEmpty = [{ ...document[0], shots: [] }, document[1], document[2]];
    expect(storyboardFromScenes(withEmpty, indexOf)).toEqual([
      { sceneNumber: 1, summary: "Food", assetIndexes: [0] },
      { sceneNumber: 2, summary: "Food", assetIndexes: [1] },
    ]);
  });
});

describe("submissionProblems", () => {
  function sized(id: string, kind: "image" | "clip", type: string, bytes: number, seconds: number | null) {
    const base = source(id, kind, seconds);
    return { ...base, file: { name: `${id}.bin`, type, size: bytes } as File };
  }

  it("accepts what the server accepts", () => {
    expect(
      submissionProblems([
        sized("a", "image", "image/jpeg", 2_000_000, null),
        sized("b", "clip", "video/mp4", 40_000_000, 20),
      ])
    ).toEqual([]);
  });

  it("refuses a MOV clip before anything is copied", () => {
    expect(submissionProblems([sized("a", "clip", "video/quicktime", 1_000, 5)]).join(" ")).toContain(
      "only MP4"
    );
  });

  it("refuses more items than a request may hold", () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      sized(`p${index}`, "image", "image/jpeg", 1_000, null)
    );
    expect(submissionProblems(many).join(" ")).toContain("at most 10");
  });

  it("refuses a clip longer than the pipeline takes", () => {
    expect(
      submissionProblems([sized("a", "clip", "video/mp4", 1_000, 90)]).join(" ")
    ).toContain("longer than");
  });
});

describe("scenePlanFromScenes — the edit the renderer receives", () => {
  const base = documentWith(
    [source("a", "image", null), source("b", "clip", 10)],
    8
  );
  const scenes = scenesFromStoryboard(base, [
    { sceneNumber: 1, summary: "Shop front", assetIndexes: [0] },
    { sceneNumber: 2, summary: "Pour", assetIndexes: [1] },
  ]);
  // Hand-edit: trim the clip to 2.0–5.5s, zoom the photo out, focus left.
  scenes[1].shots[0] = {
    ...scenes[1].shots[0],
    trimStartSeconds: 2,
    trimEndSeconds: 5.5,
    durationSeconds: 3.5,
  };
  scenes[0].shots[0] = { ...scenes[0].shots[0], motion: "ken_burns_out", focusX: 0.2 };
  scenes[1] = { ...scenes[1], transitionIn: "slide" };
  const document = { ...base, scenes };
  const plan = scenePlanFromScenes(document, (id) => ["a", "b"].indexOf(id));

  it("carries every trim, camera move, focus point and transition", () => {
    expect(plan[0].assets[0]).toMatchObject({
      assetIndex: 0,
      kind: "image",
      motion: "ken_burns_out",
      focusX: 0.2,
    });
    expect(plan[1].assets[0]).toMatchObject({
      assetIndex: 1,
      kind: "clip",
      motion: "static",
      trimStartSeconds: 2,
      trimEndSeconds: 5.5,
      durationSeconds: 3.5,
    });
    expect(plan[1].transitionIn).toBe("slide");
    expect(plan[1].visualDescriptionThai).toBe("Pour");
  });

  it("gives photos no trim fields, which the server would reject", () => {
    expect(plan[0].assets[0]).not.toHaveProperty("trimStartSeconds");
  });

  it("sizes each scene by the server's own play-length rule", () => {
    expect(plan[1].durationSeconds).toBe(3.5);
  });
});

describe("shotPlaySeconds", () => {
  it("is the longer of the slot and the trimmed window, as the server measures it", () => {
    const shot = {
      id: "s",
      sourceId: "b",
      durationSeconds: 2,
      motion: "static" as const,
      trimStartSeconds: 1,
      trimEndSeconds: 4,
      focusX: 0.5,
      focusY: 0.5,
    };
    expect(shotPlaySeconds(shot)).toBe(3);
    expect(scenesPlaySeconds([{ id: "x", transitionIn: "cut", summary: "", shots: [shot] }])).toBe(3);
  });
});

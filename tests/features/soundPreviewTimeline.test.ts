import { buildSoundPreviewTimeline, shotAt, voiceTimeAt } from "@/features/device-render/soundPreviewTimeline";
import type { EditorDocument } from "@/features/device-render/editorState";

function doc(musicTrackId: string | null, sceneShots: number[][], transitions: ("fade" | "cut")[] = []) {
  const sources = [
    { id: "img", kind: "image", file: null, previewUrl: "blob:img", posterUrl: "blob:img", durationSeconds: null, fileName: "a.jpg", aspect: 1 },
  ];
  const scenes = sceneShots.map((shots, i) => ({
    id: `s${i}`,
    transitionIn: transitions[i] ?? "fade",
    summary: "",
    shots: shots.map((d, j) => ({
      id: `s${i}-${j}`, sourceId: "img", durationSeconds: d, motion: "static",
      trimStartSeconds: 0, trimEndSeconds: null, focusX: 0.5, focusY: 0.5, frameZoom: 1,
    })),
  }));
  return { ratio: "9:16", sources, scenes, musicTrackId } as unknown as EditorDocument;
}

describe("buildSoundPreviewTimeline", () => {
  it("scene changes add no time: picture is every slot end to end", () => {
    const tl = buildSoundPreviewTimeline(doc(null, [[3, 2], [4]]), null);
    expect(tl.pictureSeconds).toBe(9);
    expect(tl.totalSeconds).toBe(9);
    expect(tl.shots.map((s) => s.startsAt)).toEqual([0, 3, 5]);
    expect(tl.transitions.map((t) => [t.at, t.seconds, t.betweenScenes])).toEqual([
      [3, 0.2, false],
      [5, 0.2, true],
    ]);
  });

  it("a cut scene has no dissolve", () => {
    const tl = buildSoundPreviewTimeline(doc(null, [[3], [3]], ["fade", "cut"]), null);
    expect(tl.transitions[0].seconds).toBe(0);
  });

  it("music delays the voice by the 0.6 s lead-in", () => {
    const tl = buildSoundPreviewTimeline(doc("track", [[10]]), 5);
    expect(tl.voiceStart).toBe(0.6);
    expect(tl.voiceEnd).toBeCloseTo(5.6);
    expect(tl.totalSeconds).toBe(10);
    expect(tl.blackTail).toBeNull();
    expect(voiceTimeAt(tl, 0.3)).toBeNull();
    expect(voiceTimeAt(tl, 1.6)).toBeCloseTo(1);
  });

  it("a voice longer than the picture runs to max(picture, voice + lead-in) over black", () => {
    const tl = buildSoundPreviewTimeline(doc("track", [[4], [4]]), 9);
    expect(tl.totalSeconds).toBeCloseTo(9.6);
    expect(tl.blackTail).toEqual({ start: 8, end: expect.closeTo(9.6) });
    expect(shotAt(tl, 8.5)).toBeNull();
  });

  it("no music means no lead-in", () => {
    const tl = buildSoundPreviewTimeline(doc(null, [[4]]), 6);
    expect(tl.voiceStart).toBe(0);
    expect(tl.totalSeconds).toBe(6);
  });
});

describe("sceneJoinDissolves", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sceneJoinDissolves } = require("@/config/montage");
  it("is 0.2 s, 0 for a cut, and never more than half a neighbouring shot", () => {
    expect(
      sceneJoinDissolves([
        { assets: [{ durationSeconds: 3 }] },
        { assets: [{ durationSeconds: 0.3 }, { durationSeconds: 2 }] },
        { transitionIn: "cut", assets: [{ durationSeconds: 3 }] },
      ])
    ).toEqual([0.15, 0]);
  });
});

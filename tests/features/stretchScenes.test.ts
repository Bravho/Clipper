/**
 * Auto-fit, step one: lengthen the storyboard to the voice without throwing
 * away the edit — proportional growth, clips into unused footage first, then
 * no slower than 0.8×, photos held up to 2.5× / 8 s.
 */
import {
  stretchScenesToLength,
  scenesPlaySeconds,
  STRETCH_CLIP_MIN_RATE,
  type EditorScene,
} from "@/features/device-render/editorState";

const photo = (id: string, seconds: number) => ({
  id: `shot-${id}`,
  sourceId: id,
  durationSeconds: seconds,
  motion: "ken_burns_in" as const,
  trimStartSeconds: 0,
  trimEndSeconds: null,
  focusX: 0.5,
  focusY: 0.5,
});
const clip = (id: string, start: number, end: number) => ({
  ...photo(id, end - start),
  motion: "static" as const,
  trimStartSeconds: start,
  trimEndSeconds: end,
});
const scene = (id: string, shots: EditorScene["shots"]): EditorScene => ({
  id,
  transitionIn: "fade",
  summary: id,
  shots,
});

const sources: Record<string, { kind: "image" | "clip"; durationSeconds: number | null }> = {
  p1: { kind: "image", durationSeconds: null },
  p2: { kind: "image", durationSeconds: null },
  c1: { kind: "clip", durationSeconds: 10 },
};
const sourceOf = (id: string) => sources[id] ?? null;

describe("stretchScenesToLength", () => {
  const scenes = [
    scene("a", [photo("p1", 2), photo("p2", 4)]),
    scene("b", [clip("c1", 1, 5)]),
  ];

  it("reaches a reachable target and keeps the edit's proportions", () => {
    const out = stretchScenesToLength(scenes, 12, sourceOf);
    expect(out.reached).toBe(true);
    expect(scenesPlaySeconds(out.scenes)).toBeCloseTo(12, 1);
    const [p1, p2] = out.scenes[0].shots;
    // The 4 s photo grew twice as much as the 2 s one.
    expect(p2.durationSeconds - 4).toBeCloseTo(2 * (p1.durationSeconds - 2), 1);
  });

  it("lengthens a clip into unused footage before slowing it", () => {
    const out = stretchScenesToLength(scenes, 12, sourceOf);
    const c = out.scenes[1].shots[0];
    expect(c.trimEndSeconds! - c.trimStartSeconds).toBeCloseTo(c.durationSeconds, 1);
    expect(out.addedFromFootage).toBeGreaterThan(0);
    expect(out.addedBySlowing).toBeCloseTo(0, 2);
  });

  it("never slows a clip below 0.8× or holds a photo past its limit", () => {
    const out = stretchScenesToLength(scenes, 100, sourceOf);
    expect(out.reached).toBe(false);
    const [p1, p2] = out.scenes[0].shots;
    expect(p1.durationSeconds).toBeCloseTo(5, 2); // 2 × 2.5
    expect(p2.durationSeconds).toBeCloseTo(8, 2); // capped at 8 s
    const c = out.scenes[1].shots[0];
    const window = c.trimEndSeconds! - c.trimStartSeconds;
    expect(window).toBeCloseTo(9, 2); // all footage from the trim start
    expect(window / c.durationSeconds).toBeGreaterThanOrEqual(STRETCH_CLIP_MIN_RATE - 1e-6);
    expect(out.totalSeconds).toBeCloseTo(out.capacitySeconds, 1);
  });

  it("leaves a storyboard that is already long enough alone", () => {
    const out = stretchScenesToLength(scenes, 5, sourceOf);
    expect(out.scenes[0].shots[0]).toBe(scenes[0].shots[0]);
    expect(out.reached).toBe(true);
  });
});

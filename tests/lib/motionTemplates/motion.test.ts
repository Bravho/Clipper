import {
  beatEnvelope,
  beatProgress,
  easeOutBack,
  normaliseTimeline,
  outro,
  sceneFraction,
  sceneIndex,
  videoProgress,
} from "@/lib/motionTemplates/motion";
import { templateTimelineForScenePlan } from "@/lib/motionTemplates/timeline";
import { counterRoll, creamCardStroke, editorialRule, templateLook } from "@/lib/motionTemplates/templateRenderer";
import { MOTION_TEMPLATES, legacyTemplateId } from "@/config/motionTemplates";

/**
 * The Look motion model is the reference three renderers port. These pin the
 * behaviour a viewer would notice: accents that land ON the cut, progress that
 * matches the edit, an outro only when the length is known.
 */

const tl = { beats: [3, 6, 9], endSeconds: 12 };

describe("motion model", () => {
  it("peaks exactly at a beat and is silent between beats", () => {
    expect(beatEnvelope(3, tl.beats, 0.06, 0.5)).toBeCloseTo(1, 6);
    expect(beatEnvelope(4.5, tl.beats, 0.06, 0.5)).toBe(0);
    expect(beatEnvelope(2.9, tl.beats, 0.06, 0.5)).toBe(0);
    const rising = beatEnvelope(2.97, tl.beats, 0.06, 0.5);
    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(1);
  });

  it("counts scenes and their progress from the cuts", () => {
    expect(sceneIndex(0, tl.beats)).toBe(0);
    expect(sceneIndex(3, tl.beats)).toBe(1);
    expect(sceneIndex(11, tl.beats)).toBe(3);
    expect(sceneFraction(4.5, tl)).toBeCloseTo(0.5, 6);
    expect(sceneFraction(10.5, tl)).toBeCloseTo(0.5, 6);
    expect(videoProgress(6, tl)).toBeCloseTo(0.5, 6);
  });

  it("has no progress or outro when the length is unknown", () => {
    const open = { beats: [3], endSeconds: null };
    expect(videoProgress(5, open)).toBe(0);
    expect(outro(100, open, 1.2)).toBe(0);
    expect(sceneFraction(5, open)).toBe(1);
  });

  it("runs the outro over the last seconds only", () => {
    expect(outro(10, tl, 1.2)).toBe(0);
    expect(outro(11.4, tl, 1.2)).toBeCloseTo(0.5, 6);
    expect(outro(12, tl, 1.2)).toBeCloseTo(1, 6);
  });

  it("finds the active beat window", () => {
    expect(beatProgress(2.78, tl.beats, 0.22, 0.44)).toBeCloseTo(0, 6);
    expect(beatProgress(3, tl.beats, 0.22, 0.44)).toBeCloseTo(0.5, 6);
    expect(beatProgress(4, tl.beats, 0.22, 0.44)).toBe(-1);
  });

  it("overshoots and settles", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
    expect(Math.max(...[0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
  });

  it("normalises what a manifest carries", () => {
    expect(normaliseTimeline([9, "x", 0.1, 3, Infinity, 11.9], 12)).toEqual({ beats: [3, 9], endSeconds: 12 });
    expect(normaliseTimeline(undefined, -1)).toEqual({ beats: [], endSeconds: null });
  });
});

describe("look gestures", () => {
  it("rolls the editorial counter from one number to the next on the cut", () => {
    const s = 1;
    expect(counterRoll(2, tl, 0, s)).toEqual([0, 1]);
    expect(counterRoll(2, tl, 1, s)[1]).toBe(0);
    const [, outgoing] = counterRoll(3.3, tl, 0, s);
    const [, incoming] = counterRoll(3.3, tl, 1, s);
    expect(outgoing).toBeLessThan(0.1);
    expect(incoming).toBeGreaterThan(0.9);
  });

  it("runs the card comet across a cut and outlines the card at the end", () => {
    expect(creamCardStroke(1, tl)[2]).toBe(0);
    const [from, to, alpha] = creamCardStroke(3.4, tl);
    expect(to).toBeGreaterThan(from);
    expect(alpha).toBeGreaterThan(0);
    const end = creamCardStroke(12, tl);
    expect(end[1]).toBeCloseTo(1, 6);
    expect(end[2]).toBe(0.9);
  });

  it("extends the kicker rule from nothing to its full length", () => {
    expect(editorialRule(0.4)).toBe(0);
    expect(editorialRule(2)).toBeCloseTo(1, 6);
  });
});

describe("catalogue", () => {
  it("has a renderer for every decorated look", () => {
    for (const t of MOTION_TEMPLATES) {
      if (t.id === "none") continue;
      expect(templateLook(t.id)).toBe(t.id);
    }
    expect(MOTION_TEMPLATES.map((t) => t.id)).toEqual(
      expect.arrayContaining(["bold_pop", "cinematic"])
    );
  });

  it("maps the new looks to one the old Mac render knows", () => {
    expect(legacyTemplateId("bold_pop")).toBe("clean_frame");
    expect(legacyTemplateId("cinematic")).toBe("editorial");
    expect(legacyTemplateId("framed_cream")).toBe("framed_cream");
    expect(legacyTemplateId(null)).toBe("none");
  });
});

describe("timeline for a scene plan", () => {
  it("puts cuts mid-crossfade and takes the longer of picture and voice", () => {
    const plan = [
      { durationSeconds: 4, assets: [] },
      { durationSeconds: 5, assets: [] },
      { durationSeconds: 3, assets: [] },
    ];
    const timeline = templateTimelineForScenePlan(plan as never, 15, 0.6);
    // Scene 2 starts at 4 − 0.2 = 3.8; the cut lands mid-crossfade at 3.9.
    expect(timeline.beats).toEqual([3.9, 8.7]);
    expect(timeline.endSeconds).toBeCloseTo(15.6, 6);
    expect(templateTimelineForScenePlan(plan as never, null, 0).endSeconds).toBeCloseTo(11.6, 6);
  });
});

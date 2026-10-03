import {
  fillCoverage,
  framePlacement,
  subjectCentre,
  subjectFromThousandths,
  suggestFrameZoom,
} from "@/lib/mobile/shotFraming";

/**
 * The framing maths the phone renderers copy. The case that matters most: a
 * tall phone clip in a wide YouTube/Facebook video, where "fill the frame"
 * keeps under a third of the clip's height and cuts the product off.
 */

const TALL = 9 / 16;
const WIDE = 16 / 9;
const canvas = { width: 1920, height: 1080 };
const clip = { width: 1080, height: 1920 };

describe("shot framing", () => {
  it("fill keeps only a third of a tall clip's height in a wide video", () => {
    expect(fillCoverage(TALL, WIDE)).toBeCloseTo(0.316, 2);
  });

  it("zoom 1 is the old cover crop, centred", () => {
    const placed = framePlacement(clip, canvas, 1, 0.5, 0.5);
    expect(placed.width).toBeCloseTo(1920);
    expect(placed.height).toBeCloseTo(3413.33, 1);
    expect(placed.x).toBeCloseTo(0);
    expect(placed.y).toBeCloseTo((1080 - 3413.33) / 2, 0);
  });

  it("zoom 0 shows the whole clip, centred with bars either side", () => {
    const placed = framePlacement(clip, canvas, 0, 0.9, 0.9);
    expect(placed.height).toBeCloseTo(1080);
    expect(placed.width).toBeCloseTo(607.5);
    expect(placed.x).toBeCloseTo((1920 - 607.5) / 2);
    expect(placed.y).toBeCloseTo(0);
  });

  it("keeps the focus point in view and never slides off a covered edge", () => {
    const bottom = framePlacement(clip, canvas, 1, 0.5, 1);
    expect(bottom.y + bottom.height).toBeCloseTo(1080);
    const top = framePlacement(clip, canvas, 1, 0.5, 0);
    expect(top.y).toBeCloseTo(0);
    const middle = framePlacement(clip, canvas, 1, 0.5, 0.75);
    // The focus row lands on the canvas centre when it can.
    expect(middle.y + 0.75 * middle.height).toBeCloseTo(540);
  });

  it("fills the frame when the shapes match", () => {
    expect(suggestFrameZoom(TALL, TALL)).toBe(1);
    expect(suggestFrameZoom(4 / 5, TALL)).toBe(1);
  });

  it("zooms out a tall clip in a wide video to keep most of it", () => {
    const zoom = suggestFrameZoom(TALL, WIDE);
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThan(0.4);
    // At that zoom at least ~80 % of the clip's height is kept.
    const placed = framePlacement(clip, canvas, zoom, 0.5, 0.5);
    expect(1080 / placed.height).toBeGreaterThanOrEqual(0.78);
  });

  it("keeps a detected subject whole, with room around it", () => {
    const subject = { x0: 0.2, y0: 0.55, x1: 0.8, y1: 0.95 };
    const zoom = suggestFrameZoom(TALL, WIDE, subject);
    const { focusX, focusY } = subjectCentre(subject);
    const placed = framePlacement(clip, canvas, zoom, focusX, focusY);
    const top = placed.y + subject.y0 * placed.height;
    const bottom = placed.y + subject.y1 * placed.height;
    expect(top).toBeGreaterThanOrEqual(-1);
    expect(bottom).toBeLessThanOrEqual(1081);
  });

  it("a small subject lets the shot fill more of the frame", () => {
    const small = suggestFrameZoom(TALL, WIDE, { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.55 });
    const large = suggestFrameZoom(TALL, WIDE, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    expect(small).toBeGreaterThan(large);
  });

  it("reads Gemini's 0–1000 boxes and rejects unusable ones", () => {
    expect(subjectFromThousandths({ xmin: 100, ymin: 200, xmax: 500, ymax: 900 })).toEqual({
      x0: 0.1,
      y0: 0.2,
      x1: 0.5,
      y1: 0.9,
    });
    expect(subjectFromThousandths({ xmin: 100, ymin: 200, xmax: 105, ymax: 900 })).toBeNull();
    expect(subjectFromThousandths(null)).toBeNull();
    expect(subjectFromThousandths({ xmin: Number.NaN, ymin: 0, xmax: 1, ymax: 1 })).toBeNull();
  });
});

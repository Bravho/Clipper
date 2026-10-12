import {
  aspectOfRatio,
  fillCoverage,
  framePlacement,
  frameForShape,
  readShapeFraming,
  readShotFocusBoxes,
  resolveShapeFraming,
  subjectFromBox2d,
  unionBoxes,
  type SubjectBox,
} from "@/lib/mobile/shotFraming";

/** What share of the picture, along each axis, ends up on the canvas. */
function visibleWindow(pictureAspect: number, ratio: string, zoom: number, fx: number, fy: number) {
  const canvasAspect = aspectOfRatio(ratio);
  const placed = framePlacement(
    { width: pictureAspect, height: 1 },
    { width: canvasAspect, height: 1 },
    zoom,
    fx,
    fy
  );
  const x0 = Math.max(0, -placed.x / placed.width);
  const x1 = Math.min(1, (canvasAspect - placed.x) / placed.width);
  const y0 = Math.max(0, -placed.y / placed.height);
  const y1 = Math.min(1, (1 - placed.y) / placed.height);
  return { x0, x1, y0, y1 };
}

function contains(window: { x0: number; x1: number; y0: number; y1: number }, box: SubjectBox) {
  const e = 1e-6;
  return window.x0 <= box.x0 + e && window.x1 >= box.x1 - e && window.y0 <= box.y0 + e && window.y1 >= box.y1 - e;
}

const TALL = 9 / 16;
const WIDE = 16 / 9;

describe("frameForShape — a shot framed for each channel shape", () => {
  it("keeps a product at the bottom of a tall clip whole in a 16:9 video (the reported bug)", () => {
    // A dish in the lower part of a 9:16 phone clip.
    const subject = { x0: 0.2, y0: 0.62, x1: 0.8, y1: 0.9 };
    const framing = frameForShape(TALL, aspectOfRatio("16:9"), { subject });
    const window = visibleWindow(TALL, "16:9", framing.frameZoom, framing.focusX, framing.focusY);
    expect(contains(window, subject)).toBe(true);
    // The old reuse — fill, focus at the centre — cut it off.
    const old = visibleWindow(TALL, "16:9", 1, 0.5, 0.5);
    expect(contains(old, subject)).toBe(false);
  });

  it("fills the frame when the subject fits a full crop, and slides toward it", () => {
    const subject = { x0: 0.3, y0: 0.7, x1: 0.7, y1: 0.85 };
    const framing = frameForShape(TALL, aspectOfRatio("16:9"), { subject });
    expect(framing.frameZoom).toBe(1);
    const window = visibleWindow(TALL, "16:9", 1, framing.focusX, framing.focusY);
    expect(contains(window, subject)).toBe(true);
  });

  it("keeps the context too when it fits, and never cuts the subject for it", () => {
    const subject = { x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.6 };
    const keep = { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.68 };
    const framing = frameForShape(TALL, aspectOfRatio("16:9"), { subject, keep });
    const window = visibleWindow(TALL, "16:9", framing.frameZoom, framing.focusX, framing.focusY);
    expect(contains(window, subject)).toBe(true);
    expect(contains(window, keep)).toBe(true);
  });

  it("zooms out for a subject too tall for any full crop, and centres it", () => {
    const subject = { x0: 0.1, y0: 0.15, x1: 0.9, y1: 0.85 };
    const framing = frameForShape(TALL, aspectOfRatio("16:9"), { subject });
    expect(framing.frameZoom).toBeLessThan(1);
    const window = visibleWindow(TALL, "16:9", framing.frameZoom, framing.focusX, framing.focusY);
    expect(contains(window, subject)).toBe(true);
  });

  it("frames a wide photo's subject on the right in a 9:16 video", () => {
    const subject = { x0: 0.7, y0: 0.3, x1: 0.88, y1: 0.7 };
    const framing = frameForShape(WIDE, aspectOfRatio("9:16"), { subject });
    const window = visibleWindow(WIDE, "9:16", framing.frameZoom, framing.focusX, framing.focusY);
    expect(contains(window, subject)).toBe(true);
  });

  it("works for every shape pair", () => {
    const subject = { x0: 0.05, y0: 0.05, x1: 0.35, y1: 0.4 };
    for (const picture of [TALL, WIDE, 1, 4 / 5, 3 / 4, 4 / 3]) {
      for (const ratio of ["9:16", "16:9", "1:1", "4:5"]) {
        const framing = frameForShape(picture, aspectOfRatio(ratio), { subject });
        const window = visibleWindow(picture, ratio, framing.frameZoom, framing.focusX, framing.focusY);
        expect(contains(window, subject)).toBe(true);
      }
    }
  });

  it("without a subject keeps the shape-only rule round the main video's focus", () => {
    const framing = frameForShape(TALL, aspectOfRatio("16:9"), null, { focusX: 0.4, focusY: 0.7 });
    expect(framing.focusX).toBe(0.4);
    expect(framing.focusY).toBe(0.7);
    // Keeps most of the picture rather than a third of it.
    expect(Math.pow(fillCoverage(TALL, WIDE), framing.frameZoom)).toBeGreaterThanOrEqual(0.79);
  });

  it("without a known picture shape fills, aimed at the subject", () => {
    const framing = frameForShape(null, WIDE, { subject: { x0: 0, y0: 0.6, x1: 0.2, y1: 0.8 } });
    expect(framing).toEqual({ focusX: 0.1, focusY: 0.7, frameZoom: 1 });
  });
});

describe("resolveShapeFraming", () => {
  it("prefers the person's own framing for that shape", () => {
    const resolved = resolveShapeFraming({
      pictureAspect: TALL,
      ratio: "16:9",
      boxes: { subject: { x0: 0.2, y0: 0.6, x1: 0.8, y1: 0.9 } },
      primary: { focusX: 0.5, focusY: 0.5 },
      manual: { focusX: 0.3, focusY: 0.2, frameZoom: 0.4 },
    });
    expect(resolved).toEqual({ focusX: 0.3, focusY: 0.2, frameZoom: 0.4, automatic: false });
  });

  it("is automatic without one", () => {
    const resolved = resolveShapeFraming({
      pictureAspect: TALL,
      ratio: "16:9",
      boxes: null,
      primary: { focusX: 0.5, focusY: 0.5 },
    });
    expect(resolved.automatic).toBe(true);
  });
});

describe("readers", () => {
  it("reads Gemini box_2d", () => {
    expect(subjectFromBox2d([100, 200, 500, 800])).toEqual({ x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.5 });
    expect(subjectFromBox2d([1, 2, 3])).toBeNull();
    expect(subjectFromBox2d("x")).toBeNull();
  });

  it("unions boxes", () => {
    expect(unionBoxes([null, { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 }, { x0: 0.2, y0: 0.1, x1: 0.5, y1: 0.3 }])).toEqual({
      x0: 0.1,
      y0: 0.1,
      x1: 0.5,
      y1: 0.4,
    });
    expect(unionBoxes([])).toBeNull();
  });

  it("reads stored framings and boxes defensively", () => {
    expect(readShapeFraming({ focusX: 2, focusY: 0.5, frameZoom: 0.3 })).toEqual({ focusX: 1, focusY: 0.5, frameZoom: 0.3 });
    expect(readShapeFraming({ focusX: "a" })).toBeNull();
    expect(readShotFocusBoxes({ subject: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 } })).toEqual({
      subject: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 },
      keep: null,
    });
    expect(readShotFocusBoxes({ subject: { x0: 0.1 } })).toBeNull();
  });
});

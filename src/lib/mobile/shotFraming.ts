/**
 * How much of a photo or clip a shot shows, when its shape is not the video's.
 *
 * THE PROBLEM. A phone clip is tall (9:16). Put it in a wide video (16:9, for
 * YouTube or Facebook) and "fill the frame" keeps under a third of its height —
 * the product at the bottom of the clip is simply gone. "Show the whole clip"
 * keeps everything but leaves wide bars down the sides. Neither is right for
 * every shot, so each shot carries a zoom between the two:
 *
 *   frameZoom 0 — the whole picture is visible (bars fill the rest);
 *   frameZoom 1 — the picture fills the frame (edges are cropped);
 *
 * and the focus point (`focusX/focusY`, 0..1 across the picture) decides which
 * part stays in view when it is cropped.
 *
 * The scale between the two ends is interpolated geometrically, so each step of
 * the slider feels the same size: at zoom z the cropped side keeps
 * `coverage ^ z` of the picture, and the other side of the frame is filled to
 * `coverage ^ (1 - z)`, where `coverage` is how much "fill" keeps.
 *
 * The same geometry lives in the two native renderers (`ShotFraming.java`,
 * `MotionMath.frameFit` in Swift) and in the storyboard preview. It is pure and
 * tested here; the native copies must agree with it.
 */

export interface SubjectBox {
  /** 0..1 across the picture. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FramePlacement {
  /** Scale from picture pixels to canvas pixels. */
  scale: number;
  /** Top-left of the drawn picture on the canvas (y grows downward). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Zoom that reproduces the old behaviour: fill the frame, crop the edges. */
export const FILL_FRAME_ZOOM = 1;

/** Without a known subject, keep at least this share of the cropped side. */
const KEEP_WITHOUT_SUBJECT = 0.8;
/**
 * Without a known subject, a crop this mild is simply filled: bars down the
 * sides of a 4:5 photo in a 9:16 video look worse than losing its edges.
 */
const FILL_WITHOUT_SUBJECT = 0.68;
/** Room left around a detected subject, as a share of the picture. */
const SUBJECT_MARGIN = 0.12;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function aspectOfRatio(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 9 / 16;
}

/** Share of the picture that "fill the frame" keeps along its cropped side. */
export function fillCoverage(pictureAspect: number, canvasAspect: number): number {
  if (!(pictureAspect > 0) || !(canvasAspect > 0)) return 1;
  return Math.min(pictureAspect / canvasAspect, canvasAspect / pictureAspect);
}

/**
 * Where the picture goes on the canvas for a zoom and a focus point.
 * Mirrors `ShotFraming.place` (Android) and `MotionMath.frameFit` (iOS).
 */
export function framePlacement(
  picture: { width: number; height: number },
  canvas: { width: number; height: number },
  frameZoom: number,
  focusX: number,
  focusY: number
): FramePlacement {
  if (!(picture.width > 0) || !(picture.height > 0)) {
    return { scale: 1, x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  const fit = Math.min(canvas.width / picture.width, canvas.height / picture.height);
  const cover = Math.max(canvas.width / picture.width, canvas.height / picture.height);
  const zoom = clamp(Number.isFinite(frameZoom) ? frameZoom : FILL_FRAME_ZOOM, 0, 1);
  const scale = fit * Math.pow(cover / fit, zoom);
  const width = picture.width * scale;
  const height = picture.height * scale;
  const place = (drawn: number, room: number, focus: number) =>
    drawn <= room
      ? (room - drawn) / 2
      : clamp(room / 2 - clamp(focus, 0, 1) * drawn, room - drawn, 0);
  return {
    scale,
    x: place(width, canvas.width, focusX),
    y: place(height, canvas.height, focusY),
    width,
    height,
  };
}

/**
 * A sensible zoom when nobody has chosen one.
 *
 * When the shapes nearly match, fill the frame — nothing worth keeping is lost.
 * Otherwise zoom out just far enough to keep the subject (with some room around
 * it) when the AI found one, or most of the picture when it did not.
 */
export function suggestFrameZoom(
  pictureAspect: number,
  canvasAspect: number,
  subject?: SubjectBox | null
): number {
  const coverage = fillCoverage(pictureAspect, canvasAspect);
  if (coverage >= 0.97) return FILL_FRAME_ZOOM;
  if (!subject && coverage >= FILL_WITHOUT_SUBJECT) return FILL_FRAME_ZOOM;
  // The picture is wider than the frame → its width is cropped, and v.v.
  const cropsWidth = pictureAspect > canvasAspect;
  let need = KEEP_WITHOUT_SUBJECT;
  if (subject) {
    const extent = cropsWidth ? subject.x1 - subject.x0 : subject.y1 - subject.y0;
    if (Number.isFinite(extent) && extent > 0) need = clamp(extent + SUBJECT_MARGIN * 2, 0.3, 1);
  }
  if (coverage >= need) return FILL_FRAME_ZOOM;
  const zoom = Math.log(need) / Math.log(coverage);
  return Math.round(clamp(zoom, 0, 1) * 20) / 20;
}

/** The focus point that centres a subject box. */
export function subjectCentre(subject: SubjectBox): { focusX: number; focusY: number } {
  return {
    focusX: Math.round(clamp((subject.x0 + subject.x1) / 2, 0, 1) * 100) / 100,
    focusY: Math.round(clamp((subject.y0 + subject.y1) / 2, 0, 1) * 100) / 100,
  };
}

/** Read Gemini's 0–1000 box into a 0..1 one; null when it is unusable. */
export function subjectFromThousandths(box: {
  xmin?: number;
  ymin?: number;
  xmax?: number;
  ymax?: number;
} | null | undefined): SubjectBox | null {
  if (!box) return null;
  const values = [box.xmin, box.ymin, box.xmax, box.ymax].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [xmin, ymin, xmax, ymax] = values.map((value) => clamp(value / 1000, 0, 1));
  if (xmax - xmin < 0.02 || ymax - ymin < 0.02) return null;
  return { x0: xmin, y0: ymin, x1: xmax, y1: ymax };
}

// ─── One shot, framed for each channel shape ─────────────────────────────────
//
// THE BUG THIS FIXES (Oct 2026). A shot's zoom and focus were decided once, for
// the MAIN video's shape, and every other channel shape reused them. A tall
// phone clip framed for 9:16 "fills the frame" there — correctly — and then
// filled a 16:9 frame too, keeping under a third of its height around a focus
// point that was only ever chosen across its width: the product at the top or
// bottom of the clip was cut off, and the picture sat off-centre.
//
// Each shape now gets its own zoom and focus, worked out from where the AI saw
// the subject IN THAT SHOT (frames from the shot's own trimmed window, not the
// clip's first frame), so every channel keeps the product whole and centred.

/** What the AI saw in one shot: the thing that must stay whole, and what is worth keeping round it. */
export interface ShotFocusBoxes {
  /** The product / dish / sign — never cut. */
  subject: SubjectBox;
  /** The subject plus the context that makes the shot (hands, plate, sign text); kept when it fits. */
  keep?: SubjectBox | null;
}

/** The framing of one shot in one shape — what the renderer is given. */
export interface ShapeFraming {
  focusX: number;
  focusY: number;
  frameZoom: number;
}

/** A person's own framing of a shot in one shape; null zoom = automatic zoom. */
export interface ManualShapeFraming {
  focusX: number;
  focusY: number;
  frameZoom: number | null;
}

/** Room kept round the subject when deciding whether a crop is safe. */
const SHAPE_SUBJECT_MARGIN = 0.05;

const round2 = (value: number) => Math.round(clamp(value, 0, 1) * 100) / 100;

/** The smallest box holding all of them; null when there are none. */
export function unionBoxes(boxes: (SubjectBox | null | undefined)[]): SubjectBox | null {
  const real = boxes.filter((box): box is SubjectBox => Boolean(box));
  if (real.length === 0) return null;
  return {
    x0: Math.min(...real.map((box) => box.x0)),
    y0: Math.min(...real.map((box) => box.y0)),
    x1: Math.max(...real.map((box) => box.x1)),
    y1: Math.max(...real.map((box) => box.y1)),
  };
}

/** A box that has grown to hold another (the keep box must hold the subject). */
function holding(outer: SubjectBox | null | undefined, inner: SubjectBox): SubjectBox {
  return outer ? (unionBoxes([outer, inner]) as SubjectBox) : inner;
}

/**
 * The zoom and focus for a picture of shape `pictureAspect` in a frame of shape
 * `canvasAspect`, keeping the AI's subject whole and centred.
 *
 * In order of preference:
 *   1. the subject AND its context fit a full-frame crop → fill, centred on them;
 *   2. the subject fits a full-frame crop → fill, the window slid as far toward
 *      the context as it can go without cutting the subject;
 *   3. otherwise zoom out just far enough that the subject (with a little room)
 *      fits, centred on it. Rounded DOWN so the subject is never shaved.
 *
 * Without boxes it falls back to the shape-only rule (`suggestFrameZoom`) round
 * `fallback` — the focus the person chose for the main video, or the centre.
 */
export function frameForShape(
  pictureAspect: number | null | undefined,
  canvasAspect: number,
  boxes: ShotFocusBoxes | null | undefined,
  fallback: { focusX: number; focusY: number } = { focusX: 0.5, focusY: 0.5 }
): ShapeFraming {
  const subject = boxes?.subject ?? null;
  const keep = subject ? holding(boxes?.keep, subject) : null;
  const centreOf = (box: SubjectBox) => ({
    focusX: round2((box.x0 + box.x1) / 2),
    focusY: round2((box.y0 + box.y1) / 2),
  });

  if (!(pictureAspect && pictureAspect > 0)) {
    // Shape unknown: fill, as the renderer always did, but at least aim at the subject.
    return { ...(keep ? centreOf(keep) : { focusX: round2(fallback.focusX), focusY: round2(fallback.focusY) }), frameZoom: FILL_FRAME_ZOOM };
  }

  const coverage = fillCoverage(pictureAspect, canvasAspect);
  if (!subject || !keep) {
    return {
      focusX: round2(fallback.focusX),
      focusY: round2(fallback.focusY),
      frameZoom: suggestFrameZoom(pictureAspect, canvasAspect, null),
    };
  }
  if (coverage >= 0.97) return { ...centreOf(keep), frameZoom: FILL_FRAME_ZOOM };

  // The picture is wider than the frame → its width is cropped, and v.v.
  const cropsWidth = pictureAspect > canvasAspect;
  const s0 = cropsWidth ? subject.x0 : subject.y0;
  const s1 = cropsWidth ? subject.x1 : subject.y1;
  const k0 = cropsWidth ? keep.x0 : keep.y0;
  const k1 = cropsWidth ? keep.x1 : keep.y1;
  const m = SHAPE_SUBJECT_MARGIN;
  const keepCentre = (k0 + k1) / 2;
  const subjectCentre = (s0 + s1) / 2;
  // The other axis is not cropped at full fill; its focus only steers a still's
  // camera move, so it aims at the subject.
  const otherCentre = cropsWidth ? (subject.y0 + subject.y1) / 2 : (subject.x0 + subject.x1) / 2;

  /** Window centre that keeps [s0−m, s1+m] inside a window of share `w`, nearest the context. */
  const slide = (w: number) => {
    const lo = Math.max(w / 2, s1 + m - w / 2);
    const hi = Math.min(1 - w / 2, s0 - m + w / 2);
    return lo <= hi ? clamp(keepCentre, lo, hi) : clamp(subjectCentre, w / 2, 1 - w / 2);
  };
  const result = (centre: number, frameZoom: number): ShapeFraming =>
    cropsWidth
      ? { focusX: round2(centre), focusY: round2(otherCentre), frameZoom }
      : { focusX: round2(otherCentre), focusY: round2(centre), frameZoom };

  if (k1 - k0 + 2 * m <= coverage) return result(slide(coverage), FILL_FRAME_ZOOM);
  if (s1 - s0 + 2 * m <= coverage) return result(slide(coverage), FILL_FRAME_ZOOM);

  const need = clamp(s1 - s0 + 2 * m, 0.3, 1);
  const raw = Math.log(need) / Math.log(coverage);
  const zoom = Math.floor(clamp(raw, 0, 1) * 20) / 20;
  return result(slide(Math.pow(coverage, zoom)), zoom);
}

/**
 * A shot's framing in one shape: the person's own choice for that shape when
 * they made one, otherwise automatic from the AI's boxes.
 */
export function resolveShapeFraming(input: {
  pictureAspect: number | null | undefined;
  ratio: string;
  boxes: ShotFocusBoxes | null | undefined;
  /** The main video's focus for this shot — the fallback when the AI saw nothing. */
  primary: { focusX: number; focusY: number };
  manual?: ManualShapeFraming | null;
}): ShapeFraming & { automatic: boolean } {
  const canvasAspect = aspectOfRatio(input.ratio);
  const auto = frameForShape(input.pictureAspect, canvasAspect, input.boxes, input.primary);
  const manual = input.manual;
  if (!manual) return { ...auto, automatic: true };
  const frameZoom =
    manual.frameZoom != null && Number.isFinite(manual.frameZoom)
      ? clamp(manual.frameZoom, 0, 1)
      : input.pictureAspect
        ? suggestFrameZoom(input.pictureAspect, canvasAspect, input.boxes?.subject ?? null)
        : FILL_FRAME_ZOOM;
  return {
    focusX: round2(manual.focusX),
    focusY: round2(manual.focusY),
    frameZoom,
    automatic: manual.frameZoom == null,
  };
}

/** Read a per-shape framing from untrusted JSON; null when unusable. */
export function readShapeFraming(value: unknown): ShapeFraming | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const numbers = [entry.focusX, entry.focusY, entry.frameZoom].map(Number);
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  const [focusX, focusY, frameZoom] = numbers.map((number) => clamp(number, 0, 1));
  return { focusX, focusY, frameZoom };
}

/** Read the AI's boxes for a shot from untrusted JSON; null when unusable. */
export function readShotFocusBoxes(value: unknown): ShotFocusBoxes | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const box = (raw: unknown): SubjectBox | null => {
    if (!raw || typeof raw !== "object") return null;
    const b = raw as Record<string, unknown>;
    const [x0, y0, x1, y1] = [b.x0, b.y0, b.x1, b.y1].map(Number);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    const out = { x0: clamp(x0, 0, 1), y0: clamp(y0, 0, 1), x1: clamp(x1, 0, 1), y1: clamp(y1, 0, 1) };
    return out.x1 - out.x0 >= 0.02 && out.y1 - out.y0 >= 0.02 ? out : null;
  };
  const subject = box(entry.subject);
  if (!subject) return null;
  return { subject, keep: box(entry.keep) };
}

/** Gemini's `box_2d` ([ymin, xmin, ymax, xmax] in 0–1000) as a 0..1 box; null when unusable. */
export function subjectFromBox2d(value: unknown): SubjectBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = value.map(Number);
  return subjectFromThousandths({ xmin, ymin, xmax, ymax });
}

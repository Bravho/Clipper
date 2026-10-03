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

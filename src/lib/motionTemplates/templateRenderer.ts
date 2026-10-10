/**
 * The motion-template (Look) layer, drawn on a 2D canvas at any time `t`.
 *
 * THE REFERENCE RENDERER. The studio's example frames use it, and the phone
 * renderers are line-for-line ports of it: Android `TemplatePainter.java`
 * (immediate-mode Canvas, the same calls) and iOS `OverlayPainter.swift`
 * (Core Animation layers whose properties are SAMPLED from the same formulas).
 * Motion formulas live in `motion.ts`. Change all three together.
 *
 * It draws the decoration ONLY — never the video. For the inset look
 * (`framed_cream`) the card's window is left transparent: the canvas and card
 * are filled even-odd around it, so whatever is under the layer (the video,
 * scaled into the window) shows through.
 *
 * Lengths use the captions' short-side scale `s = min(width, height) / 1080`.
 * The framed_cream card's padding and radii are plain pixels, as they always
 * were in the server's composition.
 *
 *   clean_frame  — corner brackets that grow out of their corners with an
 *                  overshoot, breathe, punch inward on every cut and close in
 *                  at the end; accent ripples; a segmented scene-progress bar.
 *   framed_cream — video in a white card on a warm gradient canvas; drifting
 *                  colour blobs behind the card; the branch draws on and
 *                  sways; dots bob; sparkles twinkle and pop on cuts; an
 *                  accent comet runs round the card on every cut and the card
 *                  is outlined in accent at the end.
 *   editorial    — scrims; a hairline frame that draws on; a kicker whose dot
 *                  pops and pulses on cuts; a rolling "02 / 05" scene counter;
 *                  an accent frame drawn over the hairline at the end.
 *   bold_pop     — energetic promo: colour stripes that shoot in from two
 *                  corners and slide; floating confetti shapes; a slanted
 *                  colour wipe across every cut; a progress line at the bottom.
 *   cinematic    — letterbox bars with accent hairlines, a vignette, a slow
 *                  drifting light leak, an anamorphic flare across every cut,
 *                  and bars that close in over a darkening end.
 */
import {
  beatEnvelope,
  beatProgress,
  clamp01,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  outro,
  ramp,
  sceneCount,
  sceneFraction,
  sceneIndex,
  videoProgress,
  wave,
  type TemplateTimeline,
} from "./motion";

export interface TemplatePalette {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
}

export const TEMPLATE_LOOKS = ["clean_frame", "framed_cream", "editorial", "bold_pop", "cinematic"] as const;
export type TemplateLook = (typeof TEMPLATE_LOOKS)[number] | "none";

export function templateLook(id: string | null | undefined): TemplateLook {
  return (TEMPLATE_LOOKS as readonly string[]).includes(id ?? "") ? (id as TemplateLook) : "none";
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── shared geometry ─────────────────────────────────────────────────────────

/** framed_cream's card: top 6.5 %, sides 5.5 %, bottom 13 %. */
export function cardRect(width: number, height: number): Rect {
  return { x: width * 0.055, y: height * 0.065, w: width * 0.89, h: height * (1 - 0.065 - 0.13) };
}

export const CARD_PADDING = 22;
export const CARD_RADIUS = 34;
export const WINDOW_RADIUS = 22;

/** The video's window inside the card. */
export function insetWindow(width: number, height: number): Rect {
  const c = cardRect(width, height);
  return { x: c.x + CARD_PADDING, y: c.y + CARD_PADDING, w: c.w - CARD_PADDING * 2, h: c.h - CARD_PADDING * 2 };
}

export function isInsetLook(id: string | null | undefined): boolean {
  return templateLook(id) === "framed_cream";
}

export function rgba(hex: string, alpha: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${clamp01(alpha)})`;
}

/** Linear mix of two #rrggbb colours. */
export function mixHex(a: string, b: string, k: number): string {
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((va >> shift) & 255) * (1 - k) + ((vb >> shift) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}


/** Append a rounded-rect SUBPATH (no beginPath) — `ctx.roundRect` is missing on older WebViews. */
export function addRoundRect(
  ctx: Pick<CanvasRenderingContext2D, "moveTo" | "arcTo" | "closePath">,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

type Pt = [number, number];

/**
 * A rounded rectangle traced CLOCKWISE from the middle of its top edge — the
 * same start point and direction on every platform, so a partial stroke
 * (comet, draw-on) covers the same stretch everywhere.
 */
export function roundRectFromTop(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const k = Math.min(radius, r.w / 2, r.h / 2);
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  ctx.beginPath();
  ctx.moveTo(r.x + r.w / 2, r.y);
  ctx.lineTo(right - k, r.y);
  ctx.arc(right - k, r.y + k, k, -Math.PI / 2, 0);
  ctx.lineTo(right, bottom - k);
  ctx.arc(right - k, bottom - k, k, 0, Math.PI / 2);
  ctx.lineTo(r.x + k, bottom);
  ctx.arc(r.x + k, bottom - k, k, Math.PI / 2, Math.PI);
  ctx.lineTo(r.x, r.y + k);
  ctx.arc(r.x + k, r.y + k, k, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

export function roundRectLength(r: Rect, radius: number): number {
  const k = Math.min(radius, r.w / 2, r.h / 2);
  return 2 * (r.w + r.h) - 8 * k + 2 * Math.PI * k;
}

/** Stroke only the fraction [from, to] of a path whose length is `length`. */
function strokeSegment(ctx: CanvasRenderingContext2D, length: number, from: number, to: number): void {
  const a = clamp01(from);
  const b = clamp01(to);
  if (b <= a) return;
  if (a <= 0 && b >= 1) {
    ctx.setLineDash([]);
    ctx.stroke();
    return;
  }
  ctx.setLineDash([(b - a) * length, length * 2]);
  ctx.lineDashOffset = -a * length;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

function quadLength(p0: Pt, p1: Pt, p2: Pt): number {
  let length = 0;
  let prev = p0;
  for (let i = 1; i <= 24; i++) {
    const u = i / 24;
    const x = (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0];
    const y = (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1];
    length += Math.hypot(x - prev[0], y - prev[1]);
    prev = [x, y];
  }
  return length;
}

/** The concave four-point sparkle, centred on the origin. */
function star4(ctx: CanvasRenderingContext2D, r: number): void {
  const i = r * 0.24;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.bezierCurveTo(i, -i, i, -i, r, 0);
  ctx.bezierCurveTo(i, i, i, i, 0, r);
  ctx.bezierCurveTo(-i, i, -i, i, -r, 0);
  ctx.bezierCurveTo(-i, -i, -i, -i, 0, -r);
  ctx.closePath();
}

// ── entry point ─────────────────────────────────────────────────────────────

export interface PaintTemplateInput {
  id: string | null | undefined;
  palette: TemplatePalette;
  width: number;
  height: number;
  t: number;
  timeline: TemplateTimeline;
}

/** Draw the Look's layer at time `t` onto `ctx` (which is width × height). */
export function paintTemplate(ctx: CanvasRenderingContext2D, input: PaintTemplateInput): void {
  const look = templateLook(input.id);
  ctx.save();
  switch (look) {
    case "clean_frame":
      paintCleanFrame(ctx, input);
      break;
    case "framed_cream":
      paintFramedCream(ctx, input);
      break;
    case "editorial":
      paintEditorial(ctx, input);
      break;
    case "bold_pop":
      paintBoldPop(ctx, input);
      break;
    case "cinematic":
      paintCinematic(ctx, input);
      break;
    default:
      break;
  }
  ctx.restore();
}

// ── clean_frame ─────────────────────────────────────────────────────────────

/** Corner order: top-left, top-right, bottom-right, bottom-left (clockwise). */
export const CLEAN_CORNERS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** The bracket's outward offset (px) for corner `k` at `t`. */
export function cleanBracketOffset(k: number, t: number, s: number, tl: TemplateTimeline): number {
  const intro = ramp(t, 0.1 + 0.08 * k, 0.65);
  const slide = (1 - easeOutBack(intro)) * 36 * s;
  const breathe = 5 * s * wave(t, 4.2) * ramp(t, 0.8, 0.6);
  const punch = 16 * s * beatEnvelope(t, tl.beats, 0.06, 0.5);
  const close = 22 * s * easeInOutCubic(outro(t, tl, 1.2));
  return slide + breathe - punch - close;
}

function paintCleanFrame(ctx: CanvasRenderingContext2D, input: PaintTemplateInput): void {
  const { width: W, height: H, t, timeline: tl, palette } = input;
  const s = Math.min(W, H) / 1080;
  const size = 90 * s;
  const inset = 44 * s;
  const border = Math.max(3, 7 * s);
  const radius = 22 * s;
  const half = border / 2;
  const r = Math.max(0, radius - half);
  // Arm, corner curve, arm — the whole bracket's length, for the grow-out.
  const arm = size - half - r;
  const length = 2 * arm + quadLength([r, 0], [0, 0], [0, r]);

  ctx.lineWidth = border;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  CLEAN_CORNERS.forEach(([dx, dy], k) => {
    const intro = ramp(t, 0.1 + 0.08 * k, 0.65);
    if (intro <= 0) return;
    const grow = easeOutCubic(intro);
    const o = cleanBracketOffset(k, t, s, tl);
    const x = (dx > 0 ? inset : W - inset) - dx * o;
    const y = (dy > 0 ? inset : H - inset) - dy * o;
    const cx = x + dx * half;
    const cy = y + dy * half;
    ctx.beginPath();
    ctx.moveTo(x + dx * size, cy);
    ctx.lineTo(cx + dx * r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + dy * r);
    ctx.lineTo(cx, y + dy * size);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.95 * grow})`;
    strokeSegment(ctx, length, 0.5 - grow / 2, 0.5 + grow / 2);
    ctx.restore();
  });

  // Two accent ripples pulsing from the bottom-left, 1.8 s apart.
  const ripplesIn = ramp(t, 0.6, 0.6);
  if (ripplesIn > 0) {
    const ringWidth = Math.max(2, 2.5 * s);
    ctx.lineWidth = ringWidth;
    for (const delay of [0, 1.8]) {
      const p = ((t + delay) % 3.6) / 3.6;
      const diameter = (0.15 + 0.85 * p) * Math.min(W, H) * 0.32;
      const opacity = p < 0.15 ? (p / 0.15) * 0.5 : 0.5 * (1 - (p - 0.15) / 0.85);
      ctx.strokeStyle = rgba(palette.accent, opacity * ripplesIn);
      ctx.beginPath();
      ctx.arc(W * 0.13, H * 0.84, Math.max(0, diameter / 2 - ringWidth / 2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  paintSceneProgress(ctx, input, s);
}

/**
 * clean_frame's top-centre progress: one rounded segment per scene, the past
 * ones full, the current one filling. Unknown length → the old accent bar.
 */
export function sceneProgressGeometry(W: number, s: number, scenes: number) {
  const thickness = 5 * s;
  const y = 54 * s + thickness / 2;
  const total = 240 * s;
  const gap = 10 * s;
  let count = Math.min(scenes, 12);
  let segment = (total - gap * (count - 1)) / count;
  if (segment < 12 * s) {
    count = 1;
    segment = total;
  }
  const left = (W - total) / 2;
  const segments: { x0: number; x1: number }[] = [];
  for (let i = 0; i < count; i++) {
    const x0 = left + i * (segment + gap);
    segments.push({ x0, x1: x0 + segment });
  }
  return { thickness, y, segments };
}

function paintSceneProgress(ctx: CanvasRenderingContext2D, input: PaintTemplateInput, s: number): void {
  const { width: W, t, timeline: tl, palette } = input;
  const appear = easeOutCubic(ramp(t, 0.3, 0.5));
  if (appear <= 0) return;
  if (tl.endSeconds == null) {
    ctx.fillStyle = rgba(palette.accent, 0.9 * appear);
    ctx.beginPath();
    addRoundRect(ctx, (W - 56 * s) / 2, 54 * s, 56 * s, 5 * s, 2.5 * s);
    ctx.fill();
    return;
  }
  const { thickness, y, segments } = sceneProgressGeometry(W, s, sceneCount(tl));
  const continuous = segments.length === 1;
  const index = sceneIndex(t, tl.beats);
  const fraction = continuous ? videoProgress(t, tl) : sceneFraction(t, tl);
  ctx.lineCap = "round";
  ctx.lineWidth = thickness;
  segments.forEach((seg, i) => {
    const a = seg.x0 + thickness / 2;
    const b = seg.x1 - thickness / 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.3 * appear})`;
    ctx.beginPath();
    ctx.moveTo(a, y);
    ctx.lineTo(b, y);
    ctx.stroke();
    const fill = continuous ? fraction : i < index ? 1 : i === index ? fraction : 0;
    if (fill > 0) {
      ctx.strokeStyle = rgba(palette.accent, 0.95 * appear);
      ctx.beginPath();
      ctx.moveTo(a, y);
      ctx.lineTo(a + (b - a) * fill, y);
      ctx.stroke();
    }
  });
}

// ── framed_cream ────────────────────────────────────────────────────────────

/** The card outline's comet on cuts, then the full outline at the end: [from, to, alpha]. */
export function creamCardStroke(t: number, tl: TemplateTimeline): [number, number, number] {
  const close = outro(t, tl, 1.4);
  if (close > 0) return [0, easeInOutCubic(close), 0.9];
  const p = beatProgress(t, tl.beats, 0.15, 1.1);
  if (p < 0) return [0, 0, 0];
  const head = easeInOutCubic(p);
  return [Math.max(0, head - 0.22), head, 1 - ramp(p, 0.8, 0.2)];
}

function paintFramedCream(ctx: CanvasRenderingContext2D, input: PaintTemplateInput): void {
  const { width: W, height: H, t, timeline: tl, palette } = input;
  const s = Math.min(W, H) / 1080;
  const card = cardRect(W, H);
  const win = insetWindow(W, H);
  const short = Math.min(W, H);

  // Canvas: a soft diagonal wash from the neutral into a touch of secondary,
  // with the window left open (even-odd).
  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, palette.neutral);
  wash.addColorStop(1, mixHex(palette.neutral, palette.secondary, 0.22));
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  addRoundRect(ctx, win.x, win.y, win.w, win.h, WINDOW_RADIUS);
  ctx.fill("evenodd");

  // Two flat colour blobs drifting in the margins, never inside the window.
  const appear = easeOutCubic(ramp(t, 0, 0.8));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  addRoundRect(ctx, win.x, win.y, win.w, win.h, WINDOW_RADIUS);
  ctx.clip("evenodd");
  const blobs: [number, number, number, string, number][] = [
    [W * 0.92 + 14 * s * wave(t, 7), H * 0.05 + 10 * s * wave(t, 7, 0.25), short * 0.2, palette.accent, 0.16],
    [W * 0.06 + 12 * s * wave(t, 9, 0.25), H * 0.93 + 10 * s * wave(t, 9), short * 0.24, palette.primary, 0.12],
  ];
  for (const [x, y, radius, color, alpha] of blobs) {
    ctx.fillStyle = rgba(color, alpha * appear);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The white card around the window, with its soft shadow.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  addRoundRect(ctx, card.x, card.y, card.w, card.h, CARD_RADIUS);
  addRoundRect(ctx, win.x, win.y, win.w, win.h, WINDOW_RADIUS);
  ctx.fill("evenodd");
  ctx.restore();

  // Accent comet round the card on every cut; full outline at the end.
  const [from, to, alpha] = creamCardStroke(t, tl);
  if (to > from && alpha > 0) {
    const outline: Rect = { x: card.x + 1.5 * s, y: card.y + 1.5 * s, w: card.w - 3 * s, h: card.h - 3 * s };
    roundRectFromTop(ctx, outline, CARD_RADIUS);
    ctx.strokeStyle = rgba(palette.accent, alpha);
    ctx.lineWidth = Math.max(2, 4 * s);
    ctx.lineCap = "round";
    strokeSegment(ctx, roundRectLength(outline, CARD_RADIUS), from, to);
  }

  const draw = ramp(t, 0.2, 1.4);
  const ink = palette.primary;
  const strokeWidth = Math.max(2.5, 3.2 * s);
  const dash = W * 2;
  ctx.lineCap = "round";

  // The branch: draws on, then sways about its base.
  const sway = (2.5 * Math.PI / 180) * wave(t, 5) * ramp(t, 1.2, 0.8);
  ctx.save();
  ctx.translate(W * 0.66, H * 0.9);
  ctx.scale(s, s);
  ctx.translate(0, 60);
  ctx.rotate(sway);
  ctx.translate(0, -60);
  ctx.strokeStyle = rgba(ink, 0.6);
  ctx.lineWidth = strokeWidth;
  const strokes: [Pt, Pt, Pt, Pt | null][] = [
    [[0, 60], [60, 44], [190, 6], [120, 40]],
    [[46, 48], [52, 26], [32, 18], null],
    [[84, 40], [92, 18], [72, 8], null],
    [[124, 30], [134, 8], [114, -4], null],
    [[162, 16], [172, -4], [154, -16], null],
  ];
  for (const [p0, c1, end, c2] of strokes) {
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    let length: number;
    if (c2) {
      ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], end[0], end[1]);
      length = cubicLength(p0, c1, c2, end);
    } else {
      ctx.quadraticCurveTo(c1[0], c1[1], end[0], end[1]);
      length = quadLength(p0, c1, end);
    }
    strokeSegment(ctx, length, 0, (draw * dash) / length);
  }
  ctx.restore();

  // The wave across the bottom margin: draws on, then drifts.
  const segment = W * 0.11;
  const amplitude = 14 * s;
  const drift = 8 * s * wave(t, 6) * ramp(t, 1.6, 0.6);
  let x = W * 0.14 + drift;
  const y = H * 0.945;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let waveLength = 0;
  for (let k = 0; k < 3; k++) {
    ctx.quadraticCurveTo(x + segment / 2, y - amplitude, x + segment, y);
    waveLength += quadLength([x, y], [x + segment / 2, y - amplitude], [x + segment, y]);
    x += segment;
    ctx.quadraticCurveTo(x + segment / 2, y + amplitude, x + segment, y);
    waveLength += quadLength([x, y], [x + segment / 2, y + amplitude], [x + segment, y]);
    x += segment;
  }
  ctx.strokeStyle = rgba(ink, 0.55);
  ctx.lineWidth = strokeWidth;
  strokeSegment(ctx, waveLength, 0, (draw * dash) / waveLength);

  // Three dots, bobbing out of phase.
  ctx.fillStyle = rgba(ink, 0.5 * draw);
  ([[0.12, 0.9, 4], [0.16, 0.93, 3], [0.1, 0.955, 3]] as const).forEach(([dx, dy, r], k) => {
    const bob = 4 * s * wave(t, 2.8, k / 3);
    ctx.beginPath();
    ctx.arc(W * dx, H * dy + bob, r * s, 0, Math.PI * 2);
    ctx.fill();
  });

  // Sparkles: twinkle, and pop on every cut.
  const pop = 0.5 * beatEnvelope(t, tl.beats, 0.06, 0.45);
  const sparkles: [number, number, number, number, number][] = [
    [W * 0.1, H * 0.04, 16 * s, 0, 0.8],
    [W * 0.88, H * 0.035, 10 * s, 0.5, 0.65],
  ];
  for (const [sx, sy, r, phase, alpha] of sparkles) {
    const scale = 1 + 0.15 * wave(t, 2.4, phase) + pop;
    const spin = (12 * Math.PI / 180) * wave(t, 4.8, phase);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(spin);
    ctx.scale(scale, scale);
    ctx.fillStyle = rgba(palette.accent, alpha * draw);
    star4(ctx, r);
    ctx.fill();
    ctx.restore();
  }
}

function cubicLength(p0: Pt, p1: Pt, p2: Pt, p3: Pt): number {
  let length = 0;
  let prev = p0;
  for (let i = 1; i <= 32; i++) {
    const u = i / 32;
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const d = u ** 3;
    const x = a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0];
    const y = a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1];
    length += Math.hypot(x - prev[0], y - prev[1]);
    prev = [x, y];
  }
  return length;
}

// ── editorial ───────────────────────────────────────────────────────────────

export function twoDigits(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export const COUNTER_FONT = '800 {size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function paintEditorial(ctx: CanvasRenderingContext2D, input: PaintTemplateInput): void {
  const { width: W, height: H, t, timeline: tl, palette } = input;
  const s = Math.min(W, H) / 1080;

  const top = ctx.createLinearGradient(0, 0, 0, H * 0.2);
  top.addColorStop(0, "rgba(0,0,0,0.42)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.2);
  const bottom = ctx.createLinearGradient(0, H, 0, H * 0.7);
  bottom.addColorStop(0, "rgba(0,0,0,0.55)");
  bottom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);

  // The hairline frame draws on, eased.
  const inset = Math.round(Math.min(W, H) * 0.045);
  const border = Math.max(2, 2.4 * s);
  const frame: Rect = { x: inset, y: inset, w: W - inset * 2, h: H - inset * 2 };
  const frameLength = roundRectLength(frame, 18 * s);
  const draw = easeInOutCubic(ramp(t, 0.2, 1.3));
  ctx.lineCap = "butt";
  if (draw > 0) {
    roundRectFromTop(ctx, frame, 18 * s);
    ctx.strokeStyle = rgba(palette.neutral, 0.85);
    ctx.lineWidth = border;
    strokeSegment(ctx, frameLength, 0, draw);
  }
  // At the end an accent frame draws over it.
  const close = easeInOutCubic(outro(t, tl, 1.4));
  if (close > 0) {
    roundRectFromTop(ctx, frame, 18 * s);
    ctx.strokeStyle = rgba(palette.accent, 0.95);
    ctx.lineWidth = border * 1.6;
    strokeSegment(ctx, frameLength, 0, close);
  }

  // Kicker: the dot pops in and pulses on cuts; the rule extends.
  const dotScale = easeOutBack(ramp(t, 0.35, 0.45)) * (1 + 0.6 * beatEnvelope(t, tl.beats, 0.05, 0.45));
  ctx.fillStyle = palette.accent;
  if (dotScale > 0) {
    ctx.beginPath();
    ctx.arc(inset + 34 * s, inset + 42 * s, 6 * s * dotScale, 0, Math.PI * 2);
    ctx.fill();
  }
  // The rule is a 96s × 5s pill: a round-capped 5s line whose straight part
  // (91s) extends from the left.
  const rule = editorialRule(t);
  if (rule > 0) {
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 5 * s;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(inset + 52.5 * s, inset + 41.5 * s);
    ctx.lineTo(inset + 52.5 * s + 91 * s * rule, inset + 41.5 * s);
    ctx.stroke();
  }

  paintSceneCounter(ctx, input, s, inset);
}

/** Fraction of the kicker rule's straight part that is drawn. */
export function editorialRule(t: number): number {
  return clamp01((96 * easeOutCubic(ramp(t, 0.5, 0.6)) - 5) / 91);
}

/** The "02 / 05" counter, top-right: numbers roll up on every cut. */
function paintSceneCounter(ctx: CanvasRenderingContext2D, input: PaintTemplateInput, s: number, inset: number): void {
  const { width: W, t, timeline: tl, palette } = input;
  const scenes = sceneCount(tl);
  if (scenes < 2) return;
  const appear = easeOutCubic(ramp(t, 0.6, 0.5));
  if (appear <= 0) return;
  const size = 30 * s;
  const right = W - inset - 34 * s;
  const baseline = inset + 42 * s + size * 0.36;
  const lift = (1 - appear) * 12 * s;
  ctx.font = COUNTER_FONT.replace("{size}", String(size));
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  const total = `/ ${twoDigits(scenes)}`;
  ctx.fillStyle = rgba(palette.neutral, 0.7 * appear);
  ctx.fillText(total, right, baseline + lift);
  const numberRight = right - ctx.measureText(total).width - 10 * s;

  const index = sceneIndex(t, tl.beats);
  for (let k = Math.max(0, index - 1); k <= index; k++) {
    const [dy, alpha] = counterRoll(t, tl, k, s);
    if (alpha <= 0) continue;
    ctx.fillStyle = `rgba(255,255,255,${alpha * appear})`;
    ctx.fillText(twoDigits(k + 1), numberRight, baseline + lift + dy);
  }
}

/**
 * Number k's roll: it comes up from 18s below as its cut lands and leaves
 * 18s upward at the next cut. [dy px, alpha].
 */
export function counterRoll(t: number, tl: TemplateTimeline, k: number, s: number): [number, number] {
  const enterAt = k === 0 ? null : tl.beats[k - 1];
  const leaveAt = k < tl.beats.length ? tl.beats[k] : null;
  let dy = 0;
  let alpha = 1;
  if (enterAt != null) {
    const e = easeOutCubic(ramp(t, enterAt - 0.12, 0.35));
    dy += (1 - e) * 18 * s;
    alpha *= e;
  }
  if (leaveAt != null) {
    const e = easeOutCubic(ramp(t, leaveAt - 0.12, 0.35));
    dy -= e * 18 * s;
    alpha *= 1 - e;
  }
  return [dy, alpha];
}

// ── bold_pop ────────────────────────────────────────────────────────────────

/** Stripe groups: [origin x, origin y, rotation rad, scale], lengths in s. */
export function popStripeGroups(W: number, H: number, s: number): [number, number, number, number][] {
  return [
    [-80 * s, 210 * s, -Math.PI / 4, 1],
    [W + 80 * s, H - 170 * s, (Math.PI * 3) / 4, 0.75],
  ];
}

export const POP_STRIPE_LENGTHS = [300, 220, 150];

/** How far stripe i of group g slides along its axis at t (local units). */
export function popStripeSlide(t: number, tl: TemplateTimeline, i: number): number {
  return 12 * wave(t, 3.2, i * 0.18) * ramp(t, 0.8, 0.5) + 26 * beatEnvelope(t, tl.beats, 0.06, 0.4);
}

export function popStripeDraw(t: number, g: number, i: number): number {
  return easeOutCubic(ramp(t, 0.05 + 0.09 * i + 0.12 * g, 0.5));
}

/** Confetti: [x, y (fractions), kind, colour key, base rotation deg]. */
export const POP_CONFETTI: [number, number, "ring" | "plus" | "triangle" | "dot" | "zigzag", keyof TemplatePalette, number][] = [
  [0.86, 0.2, "ring", "accent", 0],
  [0.08, 0.36, "plus", "secondary", 20],
  [0.9, 0.52, "triangle", "primary", 40],
  [0.14, 0.62, "dot", "secondary", 0],
  [0.8, 0.7, "zigzag", "accent", 80],
];

/** Confetti shapes are drawn at this multiple of their base size. */
export const POP_CONFETTI_SIZE = 1.4;

/** Confetti k's [scale, dy (px), rotation rad] at t. */
export function popConfettiState(t: number, tl: TemplateTimeline, k: number, s: number): [number, number, number] {
  const end = tl.endSeconds;
  const beats = end != null && end > 2 ? [...tl.beats, end - 1] : tl.beats;
  const scale = easeOutBack(ramp(t, 0.35 + 0.08 * k, 0.45)) + 0.35 * beatEnvelope(t, beats, 0.05, 0.4);
  const dy = 8 * s * wave(t, 2.6, k * 0.21);
  const rot = ((POP_CONFETTI[k][4] + 15 * wave(t, 5, k * 0.13)) * Math.PI) / 180;
  return [scale, dy, rot];
}

/** The cut wipe: the band's centre x for beat progress p ∈ [0, 1]. */
export function popWipeCenter(W: number, p: number): number {
  return -0.35 * W + 1.7 * W * easeInOutCubic(p);
}

export const POP_WIPE_LEAD = 0.22;
export const POP_WIPE_SECONDS = 0.44;

function paintBoldPop(ctx: CanvasRenderingContext2D, input: PaintTemplateInput): void {
  const { width: W, height: H, t, timeline: tl, palette } = input;
  const s = Math.min(W, H) / 1080;
  const colors = [palette.primary, palette.secondary, palette.accent];
  const thickness = 20 * s;

  // Stripes from the top-left and bottom-right corners.
  ctx.lineCap = "round";
  popStripeGroups(W, H, s).forEach(([ox, oy, rot, scale], g) => {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.lineWidth = thickness;
    POP_STRIPE_LENGTHS.forEach((len, i) => {
      const draw = popStripeDraw(t, g, i);
      if (draw <= 0) return;
      const slide = popStripeSlide(t, tl, i) * s;
      const y = i * 30 * s;
      ctx.strokeStyle = colors[i];
      ctx.beginPath();
      ctx.moveTo(slide, y);
      ctx.lineTo(slide + len * s * draw, y);
      ctx.stroke();
    });
    ctx.restore();
  });

  // Confetti.
  POP_CONFETTI.forEach(([fx, fy, kind, colorKey], k) => {
    const [scale, dy, rot] = popConfettiState(t, tl, k, s);
    if (scale <= 0) return;
    ctx.save();
    ctx.translate(W * fx, H * fy + dy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    const color = palette[colorKey];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = (kind === "plus" ? 8 : 6) * s;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    confettiPath(ctx, kind, s * POP_CONFETTI_SIZE);
    if (kind === "dot") ctx.fill();
    else ctx.stroke();
    ctx.restore();
  });

  // The bottom progress line with its leading dot.
  if (tl.endSeconds != null) {
    const appear = easeOutCubic(ramp(t, 0.2, 0.5));
    const p = videoProgress(t, tl);
    const y = H - 6 * s;
    ctx.fillStyle = `rgba(0,0,0,${0.25 * appear})`;
    ctx.fillRect(0, y - 6 * s, W, 12 * s);
    ctx.fillStyle = rgba(palette.accent, appear);
    ctx.fillRect(0, y - 6 * s, W * p, 12 * s);
    const dot = 10 * s * (1 + 0.3 * beatEnvelope(t, tl.beats, 0.05, 0.4)) * appear;
    ctx.fillStyle = palette.secondary;
    ctx.beginPath();
    ctx.arc(W * p, y, dot, 0, Math.PI * 2);
    ctx.fill();
  }

  // The slanted colour wipe across every cut.
  const p = beatProgress(t, tl.beats, POP_WIPE_LEAD, POP_WIPE_SECONDS);
  if (p >= 0) {
    const cx = popWipeCenter(W, p);
    const shear = 0.12 * H;
    const band = (center: number, width: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(center - width / 2 + shear, 0);
      ctx.lineTo(center + width / 2 + shear, 0);
      ctx.lineTo(center + width / 2 - shear, H);
      ctx.lineTo(center - width / 2 - shear, H);
      ctx.closePath();
      ctx.fill();
    };
    const bw = 0.2 * W;
    band(cx - bw * 0.95, bw * 0.35, rgba(palette.secondary, 0.9));
    band(cx, bw, rgba(palette.accent, 0.92));
  }
}

/** Confetti outlines, centred on the origin, in px (scaled by s). */
export function confettiPath(
  ctx: Pick<CanvasRenderingContext2D, "moveTo" | "lineTo" | "arc" | "closePath">,
  kind: (typeof POP_CONFETTI)[number][2],
  s: number
): void {
  switch (kind) {
    case "ring":
      ctx.moveTo(16 * s, 0);
      ctx.arc(0, 0, 16 * s, 0, Math.PI * 2);
      break;
    case "dot":
      ctx.moveTo(9 * s, 0);
      ctx.arc(0, 0, 9 * s, 0, Math.PI * 2);
      break;
    case "plus":
      ctx.moveTo(-18 * s, 0);
      ctx.lineTo(18 * s, 0);
      ctx.moveTo(0, -18 * s);
      ctx.lineTo(0, 18 * s);
      break;
    case "triangle": {
      const r = 18 * s;
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.866, r * 0.5);
      ctx.lineTo(-r * 0.866, r * 0.5);
      ctx.closePath();
      break;
    }
    case "zigzag":
      ctx.moveTo(-20 * s, 5 * s);
      ctx.lineTo(-10 * s, -5 * s);
      ctx.lineTo(0, 5 * s);
      ctx.lineTo(10 * s, -5 * s);
      ctx.lineTo(20 * s, 5 * s);
      break;
  }
}

// ── cinematic ───────────────────────────────────────────────────────────────

export function cinemaBarHeight(W: number, H: number): number {
  if (H / W >= 1.5) return 0.06 * H;
  if (W / H > 1.5) return 0.1 * H;
  return 0.075 * H;
}

/** Each bar's visible height at t. */
export function cinemaBars(t: number, tl: TemplateTimeline, W: number, H: number): number {
  const bar = cinemaBarHeight(W, H);
  return bar * easeOutCubic(ramp(t, 0, 0.9)) + 0.4 * bar * easeInOutCubic(outro(t, tl, 1.4));
}

/** The light leak: [centre x, centre y, alpha]. */
export function cinemaLeak(t: number, W: number, H: number): [number, number, number] {
  const x = W * (0.85 - 0.35 * (0.5 + 0.5 * wave(t, 11)));
  const y = H * (0.08 + 0.12 * (0.5 + 0.5 * wave(t, 11, 0.25)));
  const alpha = (0.22 + 0.08 * wave(t, 5.5)) * ramp(t, 0.3, 1.2);
  return [x, y, alpha];
}

export const CINEMA_FLARE_LEAD = 0.25;
export const CINEMA_FLARE_SECONDS = 0.75;

function paintCinematic(ctx: CanvasRenderingContext2D, input: PaintTemplateInput): void {
  const { width: W, height: H, t, timeline: tl, palette } = input;
  const s = Math.min(W, H) / 1080;
  const reach = Math.hypot(W / 2, H / 2);

  // Light leak first, so the vignette and bars sit over it.
  const [lx, ly, la] = cinemaLeak(t, W, H);
  if (la > 0) {
    const R = 0.7 * Math.max(W, H);
    const leak = ctx.createRadialGradient(lx, ly, 0, lx, ly, R);
    leak.addColorStop(0, rgba(palette.secondary, la));
    leak.addColorStop(0.5, rgba(palette.secondary, la * 0.35));
    leak.addColorStop(1, rgba(palette.secondary, 0));
    ctx.fillStyle = leak;
    ctx.fillRect(0, 0, W, H);
  }

  // Vignette.
  const vignette = ctx.createRadialGradient(W / 2, H / 2, reach * 0.45, W / 2, H / 2, reach);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // The anamorphic flare across every cut.
  const p = beatProgress(t, tl.beats, CINEMA_FLARE_LEAD, CINEMA_FLARE_SECONDS);
  if (p >= 0) {
    const env = Math.sin(Math.PI * p);
    const cx = W * (0.35 + 0.3 * p);
    const cy = H * 0.42;
    ctx.fillStyle = `rgba(255,255,255,${0.08 * env})`;
    ctx.fillRect(0, 0, W, H);
    // Glow: an ellipse-ish band (a radial gradient squashed vertically).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, (70 * s) / (W * 0.55));
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.55);
    glow.addColorStop(0, rgba(palette.accent, 0.45 * env));
    glow.addColorStop(1, rgba(palette.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-W * 0.55, -W * 0.55, W * 1.1, W * 1.1);
    ctx.restore();
    // Core streak.
    const core = ctx.createLinearGradient(cx - W * 0.45, 0, cx + W * 0.45, 0);
    core.addColorStop(0, "rgba(255,255,255,0)");
    core.addColorStop(0.5, `rgba(255,255,255,${0.9 * env})`);
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.fillRect(cx - W * 0.45, cy - 1.5 * s, W * 0.9, 3 * s);
  }

  // The end darkens under the closing bars.
  const close = outro(t, tl, 1.4);
  if (close > 0) {
    ctx.fillStyle = `rgba(0,0,0,${0.22 * easeInOutCubic(close)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Letterbox bars, then their accent hairlines drawn out from the centre.
  const bar = cinemaBars(t, tl, W, H);
  if (bar > 0) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
    const line = W * 0.5 * easeInOutCubic(ramp(t, 0.7, 0.9));
    if (line > 0) {
      ctx.fillStyle = rgba(palette.accent, 0.85);
      const h = Math.max(1.5, 2 * s);
      ctx.fillRect(W / 2 - line, bar - h, line * 2, h);
      ctx.fillRect(W / 2 - line, H - bar, line * 2, h);
    }
  }
}

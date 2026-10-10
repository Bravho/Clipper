/**
 * Draws text graphics on an HTML canvas — the studio's preview.
 *
 * This is the browser twin of Android's `TextGraphicsPainter`: same layout
 * (`layout.ts`), same motion (`motion.ts`), same paint rules. The phones are
 * what ship the video; this is what the requester sees before choosing.
 */
import {
  TEXT_GRAPHIC_FONTS,
  type TextGraphicStyleSpec,
} from "@/config/textGraphicStyles";
import { enterState, exitState, idleState } from "./motion";
import { frameScale, layoutTextGraphicItem, type TgItemLayout, type TgNode, type TgPaint } from "./layout";

/** `#RRGGBB[AA]` → `rgba(…)` with the colour's own alpha (shadow colours need it inline). */
export function rgba(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) return "rgba(0,0,0,0)";
  const v = parseInt(m[1], 16);
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}
import type { TextGraphicItem } from "./plan";

export function fontFamilyFor(key: string): string {
  return `rctg-${key}`;
}

let fontsLoading: Promise<void> | null = null;

/** Register and load every text-graphics font. Safe to call repeatedly. */
export function loadTextGraphicFonts(): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  if (!fontsLoading) {
    fontsLoading = Promise.all(
      Object.values(TEXT_GRAPHIC_FONTS).map(async (font) => {
        try {
          const face = new FontFace(fontFamilyFor(font.key), `url(/fonts/${font.file})`);
          await face.load();
          document.fonts.add(face);
        } catch {
          // A missing font falls back to the browser's sans-serif.
        }
      })
    ).then(() => undefined);
  }
  return fontsLoading;
}

function cssFont(key: string, size: number): string {
  return `${size}px "${fontFamilyFor(key)}", "Noto Sans Thai", sans-serif`;
}

/** `#RRGGBB` / `#RRGGBBAA` → canvas colour + its own alpha. */
export function parseColor(hex: string): { rgb: string; alpha: number } {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) return { rgb: "#000000", alpha: 0 };
  return { rgb: `#${m[1]}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

export function layoutItems(
  ctx: CanvasRenderingContext2D,
  items: TextGraphicItem[],
  style: TextGraphicStyleSpec,
  accent: string,
  width: number,
  height: number
): TgItemLayout[] {
  const measure = (text: string, fontKey: string, size: number) => {
    ctx.font = cssFont(fontKey, size);
    return ctx.measureText(text).width;
  };
  const metrics = (key: string) => {
    const font = TEXT_GRAPHIC_FONTS[key];
    return { ascent: font?.ascent ?? 1, descent: font?.descent ?? 0.3 };
  };
  return items.map((item) =>
    layoutTextGraphicItem({ item, style, accent, width, height, measure, metrics })
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fill(ctx: CanvasRenderingContext2D, color: string, alpha: number) {
  const c = parseColor(color);
  ctx.globalAlpha = alpha * c.alpha;
  ctx.fillStyle = c.rgb;
  ctx.fill();
}

/** The pin: a circle over a downward triangle in a 24-unit box, with a white eye. */
export function pinPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / 24;
  ctx.beginPath();
  ctx.arc(x + 12 * k, y + 9 * k, 7 * k, 0, Math.PI * 2);
  ctx.moveTo(x + 5.6 * k, y + 11.8 * k);
  ctx.lineTo(x + 18.4 * k, y + 11.8 * k);
  ctx.lineTo(x + 12 * k, y + 22 * k);
  ctx.closePath();
}

/** A starburst: 14 spikes, inner radius 0.8 of the outer, first spike straight up. */
export function burstPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const spikes = 14;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? r : r * 0.8;
    const angle = -Math.PI / 2 + (i * Math.PI) / spikes;
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** The panel outline of a frame, as one path (ribbon, bubble) or a rounded rect. */
function panelPath(
  ctx: CanvasRenderingContext2D,
  p: Extract<TgPaint, { type: "panel" }>,
  x: number,
  y: number,
  w: number,
  h: number
) {
  if (p.frame === "ribbon") {
    const notch = p.frameWidth;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - notch, y + h / 2);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + notch, y + h / 2);
    ctx.closePath();
    return;
  }
  if (p.frame === "slant") {
    // A parallelogram leaning right by `frameWidth`.
    const k = p.frameWidth;
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - k, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    return;
  }
  roundRect(ctx, x, y, w, h, p.radius);
  if (p.frame === "bubble") {
    const s = p.s;
    ctx.moveTo(x + 0.16 * w, y + h - 1);
    ctx.lineTo(x + 0.16 * w + 40 * s, y + h - 1);
    ctx.lineTo(x + 0.1 * w, y + h + 30 * s);
    ctx.closePath();
  }
}

function strokeRectIn(ctx: CanvasRenderingContext2D, n: TgNode, inset: number, color: string, width: number, alpha: number) {
  const c = parseColor(color);
  ctx.globalAlpha = alpha * c.alpha;
  ctx.strokeStyle = c.rgb;
  ctx.lineWidth = width;
  ctx.strokeRect(n.x + inset, n.y + inset, n.w - 2 * inset, n.h - 2 * inset);
}

function fillRectIn(ctx: CanvasRenderingContext2D, n: TgNode, inset: number, color: string, alpha: number) {
  ctx.beginPath();
  ctx.rect(n.x + inset, n.y + inset, n.w - 2 * inset, n.h - 2 * inset);
  fill(ctx, color, alpha);
}

/**
 * A painting hung on the wall: a wire to a nail above, a carved gilded
 * moulding (dark edge, gold, shaded inner half, highlight line, dark lip), a
 * white mat, the canvas, and diamond ornaments at the corners (plus the middle
 * of the top and bottom rails on a wide frame).
 */
export function paintPainting(
  ctx: CanvasRenderingContext2D,
  n: TgNode,
  p: Extract<TgPaint, { type: "panel" }>,
  alpha: number
) {
  const s = p.s;
  const fw = p.frameWidth;
  const { x, y, w, h } = n;

  // The wire and the nail, behind the frame.
  const nailX = x + w / 2;
  const nailY = y - 44 * s;
  const wire = parseColor(p.frameInner);
  ctx.globalAlpha = alpha * wire.alpha;
  ctx.strokeStyle = wire.rgb;
  ctx.lineWidth = 3 * s;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + 0.2 * w, y + fw * 0.5);
  ctx.lineTo(nailX, nailY);
  ctx.lineTo(x + 0.8 * w, y + fw * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(nailX, nailY, 7 * s, 0, Math.PI * 2);
  fill(ctx, p.frameInner, alpha);
  ctx.beginPath();
  ctx.arc(nailX - 2 * s, nailY - 2 * s, 3 * s, 0, Math.PI * 2);
  fill(ctx, p.frameAccent, alpha);

  // The moulding.
  fillRectIn(ctx, n, 0, p.frameInner, alpha);
  fillRectIn(ctx, n, 3 * s, p.frameColor, alpha);
  fillRectIn(ctx, n, fw * 0.5, "#00000026", alpha);
  strokeRectIn(ctx, n, fw * 0.28, p.frameAccent, 2.5 * s, alpha);
  strokeRectIn(ctx, n, fw - 1.5 * s, p.frameInner, 3 * s, alpha);
  // Mitred joints at the four corners.
  const joint = parseColor(p.frameInner);
  ctx.globalAlpha = alpha * joint.alpha;
  ctx.strokeStyle = joint.rgb;
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + fw, y + fw);
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w - fw, y + fw);
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + fw, y + h - fw);
  ctx.moveTo(x + w, y + h);
  ctx.lineTo(x + w - fw, y + h - fw);
  ctx.stroke();

  // Mat and canvas.
  fillRectIn(ctx, n, fw, p.frameMat, alpha);
  fillRectIn(ctx, n, fw + 12 * s, p.color, alpha);
  strokeRectIn(ctx, n, fw + 12 * s, "#00000030", 1.5 * s, alpha);

  // Ornaments.
  const spots: [number, number][] = [
    [x + fw / 2, y + fw / 2],
    [x + w - fw / 2, y + fw / 2],
    [x + fw / 2, y + h - fw / 2],
    [x + w - fw / 2, y + h - fw / 2],
  ];
  if (w > 6 * fw) spots.push([x + w / 2, y + fw / 2], [x + w / 2, y + h - fw / 2]);
  const d = fw * 0.34;
  for (const [cx, cy] of spots) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - d);
    ctx.lineTo(cx + d, cy);
    ctx.lineTo(cx, cy + d);
    ctx.lineTo(cx - d, cy);
    ctx.closePath();
    fill(ctx, p.frameAccent, alpha);
    ctx.beginPath();
    ctx.arc(cx, cy, fw * 0.1, 0, Math.PI * 2);
    fill(ctx, p.frameInner, alpha);
  }
}

function paintPanel(ctx: CanvasRenderingContext2D, n: TgNode, p: Extract<TgPaint, { type: "panel" }>, alpha: number) {
  if (p.frame === "none") return;
  const s = p.s;
  const shadow = parseColor(p.shadow);
  if ((p.shadowDx !== 0 || p.shadowDy !== 0) && shadow.alpha > 0) {
    panelPath(ctx, p, n.x + p.shadowDx, n.y + p.shadowDy, n.w, n.h);
    fill(ctx, p.shadow, alpha);
  }
  if (p.frame === "painting") {
    paintPainting(ctx, n, p, alpha);
    return;
  }
  panelPath(ctx, p, n.x, n.y, n.w, n.h);
  fill(ctx, p.color, alpha);
  if (p.frame === "postit") {
    // A faint curl along the bottom edge, then the tape.
    ctx.beginPath();
    ctx.rect(n.x, n.y + n.h - 10 * s, n.w, 10 * s);
    fill(ctx, "#00000012", alpha);
    const tw = Math.min(0.42 * n.w, 150 * s);
    const th = 34 * s;
    ctx.save();
    ctx.translate(n.x + n.w / 2, n.y + 2 * s);
    ctx.rotate((-5 * Math.PI) / 180);
    ctx.beginPath();
    ctx.rect(-tw / 2, -th / 2, tw, th);
    fill(ctx, p.tape, alpha);
    ctx.restore();
  }
}

function paintText(ctx: CanvasRenderingContext2D, n: TgNode, p: Extract<TgPaint, { type: "text" }>, alpha: number) {
  const c = parseColor(p.color);
  ctx.font = cssFont(p.font, p.size);
  ctx.textBaseline = "alphabetic";
  const x = n.x;
  const y = n.y + p.ascent * p.size;
  const e = p.effect;
  if (e.kind === "marker") {
    // A highlighter stroke across the lower half of the words, leaning right.
    const x0 = n.x - e.width;
    const w0 = n.w + 2 * e.width;
    const y0 = n.y + 0.5 * n.h;
    const h0 = 0.42 * n.h;
    const k = 0.3 * h0;
    ctx.beginPath();
    ctx.moveTo(x0 + k, y0);
    ctx.lineTo(x0 + w0, y0);
    ctx.lineTo(x0 + w0 - k, y0 + h0);
    ctx.lineTo(x0, y0 + h0);
    ctx.closePath();
    fill(ctx, e.color, alpha);
  }
  if (e.kind === "outline") {
    const oc = parseColor(e.color);
    ctx.globalAlpha = alpha * oc.alpha;
    ctx.strokeStyle = oc.rgb;
    ctx.lineWidth = e.width;
    ctx.lineJoin = "round";
    ctx.strokeText(p.text, x, y);
  }
  ctx.globalAlpha = alpha * c.alpha;
  ctx.fillStyle = c.rgb;
  if (e.kind === "shadow" || e.kind === "glow" || e.kind === "marker") {
    ctx.save();
    ctx.shadowColor = e.kind === "marker" ? "rgba(0,0,0,0.55)" : rgba(e.color);
    ctx.shadowBlur = e.blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = e.dy;
    ctx.fillText(p.text, x, y);
    if (e.kind === "glow") ctx.fillText(p.text, x, y);
    ctx.restore();
    ctx.globalAlpha = alpha * c.alpha;
    ctx.fillStyle = c.rgb;
  }
  ctx.fillText(p.text, x, y);
}

function paintNode(ctx: CanvasRenderingContext2D, n: TgNode, alpha: number) {
  const p: TgPaint = n.paint;
  switch (p.type) {
    case "panel":
      paintPanel(ctx, n, p, alpha);
      break;
    case "box": {
      const sh = parseColor(p.shadow);
      if ((p.shadowDx !== 0 || p.shadowDy !== 0) && sh.alpha > 0) {
        roundRect(ctx, n.x + p.shadowDx, n.y + p.shadowDy, n.w, n.h, p.radius);
        fill(ctx, p.shadow, alpha);
      }
      roundRect(ctx, n.x, n.y, n.w, n.h, p.radius);
      fill(ctx, p.color, alpha);
      break;
    }
    case "text":
      paintText(ctx, n, p, alpha);
      break;
    case "dot": {
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      const r = n.w / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      fill(ctx, "#FFFFFF", alpha);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
      fill(ctx, p.color, alpha);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      fill(ctx, "#FFFFFF", alpha);
      break;
    }
    case "pin": {
      pinPath(ctx, n.x, n.y, n.w);
      fill(ctx, p.color, alpha);
      const k = n.w / 24;
      ctx.beginPath();
      ctx.arc(n.x + 12 * k, n.y + 9 * k, 2.8 * k, 0, Math.PI * 2);
      fill(ctx, "#FFFFFF", alpha);
      break;
    }
    case "badge": {
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      const ring = parseColor(p.ring);
      if (p.shape === "circle") {
        const r = Math.min(n.w, n.h) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        fill(ctx, p.bg, alpha);
        if (ring.alpha > 0) {
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
          ctx.setLineDash([r * 0.12, r * 0.08]);
          ctx.lineWidth = r * 0.05;
          ctx.globalAlpha = alpha * ring.alpha;
          ctx.strokeStyle = ring.rgb;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (p.shape === "burst") {
        burstPath(ctx, cx, cy, Math.min(n.w, n.h) / 2);
        fill(ctx, p.bg, alpha);
      } else {
        roundRect(ctx, n.x, n.y, n.w, n.h, n.h * 0.3);
        fill(ctx, p.bg, alpha);
        if (ring.alpha > 0) {
          const inset = n.h * 0.12;
          roundRect(ctx, n.x + inset, n.y + inset, n.w - 2 * inset, n.h - 2 * inset, n.h * 0.2);
          ctx.setLineDash([n.h * 0.1, n.h * 0.07]);
          ctx.lineWidth = n.h * 0.05;
          ctx.globalAlpha = alpha * ring.alpha;
          ctx.strokeStyle = ring.rgb;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      const c = parseColor(p.color);
      ctx.font = cssFont(p.font, p.size);
      const tw = ctx.measureText(p.text).width;
      const top = cy - ((p.ascent + p.descent) * p.size) / 2;
      ctx.globalAlpha = alpha * c.alpha;
      ctx.fillStyle = c.rgb;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(p.text, cx - tw / 2, top + p.ascent * p.size);
      break;
    }
    default:
      break;
  }
}

function anchorPoint(n: TgNode): [number, number] {
  if (n.anchor === "center") return [n.x + n.w / 2, n.y + n.h / 2];
  if (n.anchor === "top") return [n.x + n.w / 2, n.y];
  return [n.x, n.y + n.h / 2];
}

function drawNode(ctx: CanvasRenderingContext2D, n: TgNode, lt: number, alpha: number, s: number) {
  const st = enterState(n.anim, lt);
  if (!st.visible) return;
  ctx.save();
  const a = alpha * st.alpha;
  if (st.translateY !== 0) ctx.translate(0, st.translateY * s);
  if (st.scaleX !== 1 || st.scaleY !== 1) {
    const [ax, ay] = anchorPoint(n);
    ctx.translate(ax, ay);
    ctx.scale(Math.max(0.0001, st.scaleX), Math.max(0.0001, st.scaleY));
    ctx.translate(-ax, -ay);
  }
  if (st.clipRight < 1) {
    ctx.beginPath();
    ctx.rect(n.x - 60 * s, n.y - 600 * s, 60 * s + (n.w + 20 * s) * st.clipRight, n.h + 1200 * s);
    ctx.clip();
  }
  if (st.clipToSelf) {
    ctx.beginPath();
    ctx.rect(n.x - 6 * s, n.y - 2 * s, n.w + 12 * s, n.h + 4 * s);
    ctx.clip();
    ctx.translate(0, st.riseFraction * n.h);
  }
  const idle = idleState(n.idle, n.anim, lt);
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  if (idle.translateY !== 0) ctx.translate(0, idle.translateY * s);
  if (idle.rotateDeg !== 0 || idle.scale !== 1 || n.rotate !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(((idle.rotateDeg + n.rotate) * Math.PI) / 180);
    ctx.scale(idle.scale, idle.scale);
    ctx.translate(-cx, -cy);
  }
  paintNode(ctx, n, a);
  for (const child of n.children) drawNode(ctx, child, lt, a, s);
  ctx.restore();
}

/** Draw every item that is on screen at video time `t`. Returns whether anything was drawn. */
export function drawTextGraphicsFrame(
  ctx: CanvasRenderingContext2D,
  layouts: TgItemLayout[],
  style: TextGraphicStyleSpec,
  width: number,
  height: number,
  t: number
): boolean {
  const s = frameScale(width, height);
  let drawn = false;
  for (const layout of layouts) {
    const { item } = layout;
    if (t < item.start || t > item.end) continue;
    drawn = true;
    const lt = t - item.start;
    const ex = exitState(style.motion.exit, t, item.end);
    const px = layout.pivotX;
    const py = layout.pivotY;
    ctx.save();
    ctx.translate(ex.translateX * s, 0);
    ctx.translate(px, py);
    if (ex.scale !== 1) ctx.scale(ex.scale, ex.scale);
    if (style.shape.tiltDeg !== 0) ctx.rotate((style.shape.tiltDeg * Math.PI) / 180);
    ctx.translate(-px, -py);
    for (const n of layout.nodes) drawNode(ctx, n, lt, ex.alpha, s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  return drawn;
}

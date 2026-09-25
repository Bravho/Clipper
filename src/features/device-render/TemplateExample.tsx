"use client";

import { useEffect, useState } from "react";

import type { MotionTemplate } from "@/config/motionTemplates";

/**
 * A still example frame of a Look, drawn from the person's own material.
 *
 * WHY DRAWN HERE AND NOT A STOCK PICTURE. A template is judged against the
 * footage it will sit on, so the example uses the first photo or clip frame
 * of THIS request, at the shape being made. The frame and decor are the same
 * geometry the phone renderers paint (`TemplatePainter.java`,
 * `OverlayPainter.swift`) — both ports of `remotion/TemplatedVideo.tsx`, the
 * server's styled render — scaled by the short side. The decor that animates
 * in the video is shown at rest.
 *
 * The palette is the default one. The real render derives a palette from the
 * script, so accent colours can differ; the frame and placement cannot.
 */

// `DEFAULT_PALETTE` in src/lib/ai/paletteService.ts — copied rather than
// imported because that module is server-side (it calls Gemini).
const PALETTE = { primary: "#FF6B35", secondary: "#FFB703", accent: "#06D6A0", neutral: "#FFFFFF" };

function ratioSize(ratio: string, height: number): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  const width = w > 0 && h > 0 ? Math.round((height * w) / h) : Math.round((height * 9) / 16);
  return { width, height };
}

function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Cover-fit the picture into the rect, the way the renderer fills a shot. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  x: number,
  y: number,
  width: number,
  height: number
) {
  if (!image) {
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, "#3a4455");
    gradient.addColorStop(1, "#141821");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    return;
  }
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * Paint one example frame. Exported for reuse; the component below calls it.
 *
 * Geometry is `remotion/TemplatedVideo.tsx` — the server's styled render, and
 * what the phone renderers draw (`TemplatePainter.java`, `OverlayPainter.swift`)
 * — at rest: brackets eased in, strokes fully drawn, one ripple mid-pulse.
 */
export function paintTemplateExample(
  canvas: HTMLCanvasElement,
  template: MotionTemplate,
  picture: HTMLImageElement | null,
  sampleCaption: string
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  // The composition's short-side scale, against a 1080 reference.
  const s = Math.min(width, height) / 1080;

  // ── the picture: full-bleed, or inset in the framed_cream card ──
  if (template.id === "framed_cream") {
    const card = {
      x: width * 0.055,
      y: height * 0.065,
      w: width * 0.89,
      h: height * (1 - 0.065 - 0.13),
    };
    // Card padding and radii are plain pixels in the composition (at 1080
    // wide); scaled here with the example's size.
    const k = width / (width > height ? 1920 : 1080);
    const pad = 22 * k;
    const win = { x: card.x + pad, y: card.y + pad, w: card.w - pad * 2, h: card.h - pad * 2 };
    ctx.fillStyle = PALETTE.neutral;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = 42 * k;
    ctx.shadowOffsetY = 16 * k;
    ctx.fillStyle = "#ffffff";
    roundRectPath(ctx, card.x, card.y, card.w, card.h, 34 * k);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, win.x, win.y, win.w, win.h, 22 * k);
    ctx.clip();
    drawCover(ctx, picture, win.x, win.y, win.w, win.h);
    ctx.restore();
  } else {
    drawCover(ctx, picture, 0, 0, width, height);
  }

  // ── decoration ──
  if (template.id === "clean_frame") {
    const size = 90 * s;
    const inset = 44 * s;
    const border = Math.max(1.5, 7 * s);
    const radius = 22 * s;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = border;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 4 * s;
    ctx.shadowOffsetY = 1 * s;
    const bracket = (x: number, y: number, dx: number, dy: number) => {
      const half = border / 2;
      const cx = x + dx * half;
      const cy = y + dy * half;
      const r = Math.max(0, radius - half);
      ctx.beginPath();
      ctx.moveTo(x + dx * size, cy);
      ctx.lineTo(cx + dx * r, cy);
      ctx.quadraticCurveTo(cx, cy, cx, cy + dy * r);
      ctx.lineTo(cx, y + dy * size);
      ctx.stroke();
    };
    bracket(inset, inset, 1, 1);
    bracket(width - inset, inset, -1, 1);
    bracket(inset, height - inset, 1, -1);
    bracket(width - inset, height - inset, -1, -1);
    ctx.restore();

    // One ripple, a third of the way through its pulse.
    const p = 0.33;
    const diameter = (0.15 + 0.85 * p) * Math.min(width, height) * 0.32;
    ctx.strokeStyle = withAlpha(PALETTE.accent, 0.5 * (1 - (p - 0.15) / 0.85));
    ctx.lineWidth = Math.max(1, 2.5 * s);
    ctx.beginPath();
    ctx.arc(width * 0.13, height * 0.84, diameter / 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = withAlpha(PALETTE.accent, 0.9);
    roundRectPath(ctx, (width - 56 * s) / 2, 54 * s, 56 * s, 5 * s, 2.5 * s);
    ctx.fill();
  }

  if (template.id === "framed_cream") {
    const ink = PALETTE.primary;
    const sw = Math.max(1.2, 3.2 * s);
    ctx.lineCap = "round";
    // The botanical branch, in its own units, scaled by s.
    ctx.save();
    ctx.translate(width * 0.66, height * 0.9);
    ctx.scale(s, s);
    ctx.strokeStyle = withAlpha(ink, 0.6);
    ctx.lineWidth = sw;
    ctx.beginPath();
    ctx.moveTo(0, 60);
    ctx.bezierCurveTo(60, 44, 120, 40, 190, 6);
    for (const [x, y, c1, c2, e1, e2] of [
      [46, 48, 6, -22, -14, -30],
      [84, 40, 8, -22, -12, -32],
      [124, 30, 10, -22, -10, -34],
      [162, 16, 10, -20, -8, -32],
    ]) {
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + c1, y + c2, x + e1, y + e2);
    }
    ctx.stroke();
    ctx.restore();

    // The wave across the bottom margin.
    const seg = width * 0.11;
    const amp = 14 * s;
    let x = width * 0.14;
    const y = height * 0.945;
    ctx.strokeStyle = withAlpha(ink, 0.55);
    ctx.lineWidth = sw;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      ctx.quadraticCurveTo(x + seg / 2, y - amp, x + seg, y);
      x += seg;
      ctx.quadraticCurveTo(x + seg / 2, y + amp, x + seg, y);
      x += seg;
    }
    ctx.stroke();

    ctx.fillStyle = withAlpha(ink, 0.5);
    for (const [dx, dy, r] of [
      [0.12, 0.9, 4],
      [0.16, 0.93, 3],
      [0.1, 0.955, 3],
    ]) {
      ctx.beginPath();
      ctx.arc(width * dx, height * dy, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = withAlpha(PALETTE.accent, 0.8);
    star4(ctx, width * 0.1, height * 0.04, 16 * s);
    ctx.fill();
  }

  if (template.id === "editorial") {
    const top = ctx.createLinearGradient(0, 0, 0, height * 0.2);
    top.addColorStop(0, "rgba(0,0,0,0.42)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, width, height * 0.2);
    const bottom = ctx.createLinearGradient(0, height, 0, height * 0.7);
    bottom.addColorStop(0, "rgba(0,0,0,0.55)");
    bottom.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bottom;
    ctx.fillRect(0, height * 0.7, width, height * 0.3);

    const inset = Math.round(Math.min(width, height) * 0.045);
    ctx.strokeStyle = withAlpha(PALETTE.neutral, 0.85);
    ctx.lineWidth = Math.max(1, 2.4 * s);
    roundRectPath(ctx, inset, inset, width - inset * 2, height - inset * 2, 18 * s);
    ctx.stroke();

    ctx.fillStyle = PALETTE.accent;
    ctx.beginPath();
    ctx.arc(inset + 34 * s, inset + 42 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
    roundRectPath(ctx, inset + 50 * s, inset + 39 * s, 96 * s, 5 * s, 2.5 * s);
    ctx.fill();
  }

  // ── a sample caption plate, as `Subtitles` draws one (English, 52 px) ──
  if (sampleCaption) {
    const fontSize = Math.max(8, 52 * s);
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textWidth = Math.min(ctx.measureText(sampleCaption).width, width * 0.8);
    const plateW = textWidth + 52 * s;
    const plateH = fontSize * 1.22 + 20 * s;
    const plateBottom = height - 150 * s;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRectPath(ctx, (width - plateW) / 2, plateBottom - plateH, plateW, plateH, 18 * s);
    ctx.fill();
    const cy = plateBottom - plateH / 2;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, 6 * s);
    ctx.strokeStyle = "#000";
    ctx.strokeText(sampleCaption, width / 2, cy, width * 0.8);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(sampleCaption, width / 2, cy, width * 0.8);
  }
}

function star4(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const i = r * 0.24;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx + i, cy - i, cx + i, cy - i, cx + r, cy);
  ctx.bezierCurveTo(cx + i, cy + i, cx + i, cy + i, cx, cy + r);
  ctx.bezierCurveTo(cx - i, cy + i, cx - i, cy + i, cx - r, cy);
  ctx.bezierCurveTo(cx - i, cy - i, cx - i, cy - i, cx, cy - r);
  ctx.closePath();
}

export function TemplateExample({
  template,
  pictureUrl,
  ratio,
  sampleCaption = "Your caption appears here",
  height = 240,
  alt,
}: {
  template: MotionTemplate;
  pictureUrl: string | null;
  ratio: string;
  sampleCaption?: string;
  /** The frame's description for screen readers; defaults to the template id. */
  alt?: string;
  /** Display height in CSS pixels; drawn at twice that for a sharp retina tile. */
  height?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const size = ratioSize(ratio, height);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const picture = pictureUrl ? await loadImage(pictureUrl) : null;
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      const drawn = ratioSize(ratio, height * 2);
      canvas.width = drawn.width;
      canvas.height = drawn.height;
      paintTemplateExample(canvas, template, picture, sampleCaption);
      try {
        setSrc(canvas.toDataURL("image/jpeg", 0.85));
      } catch {
        // A tainted canvas cannot be exported. The picture is always a local
        // object URL, so this should not happen; show the placeholder if it does.
        setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [height, pictureUrl, ratio, sampleCaption, template]);

  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a data URL drawn on the phone
    <img
      src={src}
      alt={alt ?? `Example frame: ${template.id}`}
      width={size.width}
      height={size.height}
      className="studio-look-frame"
    />
  ) : (
    <span
      className="studio-look-frame studio-look-frame-empty"
      style={{ width: size.width, height: size.height }}
      aria-hidden
    />
  );
}

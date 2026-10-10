"use client";

import { useEffect, useState } from "react";

import type { MotionTemplate } from "@/config/motionTemplates";
import type { TemplateTimeline } from "@/lib/motionTemplates/motion";
import { insetWindow, isInsetLook, paintTemplate } from "@/lib/motionTemplates/templateRenderer";

/**
 * A still example frame of a Look, drawn from the person's own material.
 *
 * WHY DRAWN HERE AND NOT A STOCK PICTURE. A template is judged against the
 * footage it will sit on, so the example uses the first photo or clip frame
 * of THIS request, at the shape being made. The decoration is drawn by
 * `src/lib/motionTemplates/templateRenderer.ts`, the reference the phone
 * renderers (`TemplatePainter.java`, `OverlayPainter.swift`) are ported from,
 * frozen at one representative moment.
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
 * The moment the example frame shows, on a sample four-scene, 12-second
 * timeline: early in scene 2, after every entrance has settled and between
 * cut accents — so the progress bar, counter and floating decor are mid-flight
 * and nothing is caught half-wiped.
 */
const EXAMPLE_TIME = 3.2;
const EXAMPLE_TIMELINE: TemplateTimeline = { beats: [2, 5, 8], endSeconds: 12 };

/**
 * Paint one example frame. Exported for reuse; the component below calls it.
 *
 * The decoration is `paintTemplate` — the reference renderer the phone
 * renderers are ported from — at {@link EXAMPLE_TIME}.
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
  const s = Math.min(width, height) / 1080;

  // ── the picture: full-bleed, or inside the framed_cream card's window ──
  if (isInsetLook(template.id)) {
    const win = insetWindow(width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(win.x, win.y, win.w, win.h);
    ctx.clip();
    drawCover(ctx, picture, win.x, win.y, win.w, win.h);
    ctx.restore();
  } else {
    drawCover(ctx, picture, 0, 0, width, height);
  }

  paintTemplate(ctx, {
    id: template.id,
    palette: PALETTE,
    width,
    height,
    t: EXAMPLE_TIME,
    timeline: EXAMPLE_TIMELINE,
  });

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

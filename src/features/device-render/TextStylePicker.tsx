"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TEXT_GRAPHIC_CHOICES,
  getTextGraphicStyle,
  type TextGraphicChoice,
  type TextGraphicStyleId,
} from "@/config/textGraphicStyles";
import {
  drawTextGraphicsFrame,
  layoutItems,
  loadTextGraphicFonts,
} from "@/lib/textGraphics/canvasRenderer";
import {
  sanitizeTextGraphicItems,
  sceneWindows,
  type ManifestTextGraphics,
  type TextGraphicItem,
  type TextGraphicsPlan,
} from "@/lib/textGraphics/plan";
import type { TgItemLayout } from "@/lib/textGraphics/layout";
import { DEVICE_SCENE_CROSSFADE_SECONDS } from "@/lib/mobile/deviceRenderCaptions";
import { shotPlaySeconds, type EditorDocument } from "./editorState";
import { useStudioT, type StudioT } from "./studioI18n";

/**
 * Graphic → Text graphics: pick the style pack the scene titles are drawn in,
 * and preview them.
 *
 * Every option plays an animated example over this request's first picture
 * (sample words, the pack's own motion). "Preview with your video" then asks
 * the server for the real plan — the words Claude writes for THESE scenes —
 * and plays it over the scene pictures on the edit's own timeline. Both are
 * drawn by `canvasRenderer.ts`, the browser twin of the phone renderers.
 */

const FRAME: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

function frameFor(ratio: string) {
  return FRAME[ratio] ?? FRAME["9:16"];
}

const DEFAULT_ACCENT = "#D7262E";
/** When the snapshot is taken: every part has entered, nothing has started to leave. */
const SNAPSHOT_SECONDS = 2.2;

function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  width: number,
  height: number
) {
  if (!image) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#3a4455");
    gradient.addColorStop(1, "#141821");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/**
 * The snapshot backdrop: a soft, photo-like blur of warm and cool tones rather
 * than real footage — the card shows the GRAPHIC, and drawing it costs one
 * paint instead of decoding a picture and running an animation loop.
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#4a3b33");
  base.addColorStop(0.55, "#2a2f3a");
  base.addColorStop(1, "#161a22");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  const blobs: [number, number, number, string][] = [
    [0.72, 0.3, 0.45, "rgba(232,150,90,0.35)"],
    [0.25, 0.75, 0.5, "rgba(90,140,200,0.25)"],
    [0.55, 0.85, 0.35, "rgba(250,220,170,0.18)"],
  ];
  for (const [fx, fy, fr, color] of blobs) {
    const r = fr * Math.max(width, height);
    const g = ctx.createRadialGradient(fx * width, fy * height, 0, fx * width, fy * height, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  // Where the captions will sit, so the graphic is judged next to them.
  const s = Math.min(width, height) / 1080;
  const barW = Math.min(width * 0.62, 640 * s);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect((width - barW) / 2, height - 150 * s - 70 * s, barW, 70 * s);
}

/** The sample label every option shows, in the studio's language. */
function sampleLabel(t: StudioT, position = ""): TextGraphicItem {
  return sanitizeTextGraphicItems(
    [
      {
        kind: "label",
        start: 0,
        end: 10,
        title: t("studio.text.sample.label"),
        sub: t("studio.text.sample.labelSub"),
        badge: t("studio.text.sample.badge"),
        position,
      },
    ],
    10
  )[0];
}

/** Run `draw(t)` on animation frames while the canvas is on screen. */
function useCanvasLoop(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  draw: (seconds: number) => void,
  running: boolean
) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !running) return;
    let visible = true;
    let frame = 0;
    const started = performance.now();
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          })
        : null;
    observer?.observe(element);
    const tick = (now: number) => {
      if (visible && document.visibilityState === "visible") {
        drawRef.current((now - started) / 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [canvas, running]);
}

/** Size the canvas backing store for the device pixel ratio; returns the 2D context. */
function prepareCanvas(
  element: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  frame: { width: number; height: number }
): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const pw = Math.round(cssWidth * dpr);
  const ph = Math.round(cssHeight * dpr);
  if (element.width !== pw || element.height !== ph) {
    element.width = pw;
    element.height = ph;
  }
  const ctx = element.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(pw / frame.width, 0, 0, ph / frame.height, 0, 0);
  return ctx;
}

/**
 * One option's example: a STILL of its graphic over a neutral backdrop, drawn
 * once when the fonts are ready. No footage and no animation loop — nine of
 * these sit on one screen of a phone.
 */
/** The snapshot's stage: a fixed 9:8 frame, so every option reads at the same size whatever the shape. */
const SNAPSHOT_FRAME = { width: 1080, height: 960 };

/**
 * One option's example: a STILL of its graphic over a neutral backdrop, drawn
 * once when the fonts are ready. No footage and no animation loop — nine of
 * these sit on one screen of a phone. It is drawn on a fixed 9:8 stage rather
 * than the video's shape, so a 9:16 or 16:9 video still gets a readable
 * example; the frame, the text treatment and the position are the pack's own.
 */
function TextStyleExample({ choice, alt }: { choice: TextGraphicChoice; alt: string }) {
  const t = useStudioT();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let live = true;
    void loadTextGraphicFonts().then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !fontsReady) return;
    const frame = SNAPSHOT_FRAME;
    const cssWidth = element.clientWidth || 300;
    const ctx = prepareCanvas(element, cssWidth, (cssWidth * frame.height) / frame.width, frame);
    if (!ctx) return;
    drawBackdrop(ctx, frame.width, frame.height);
    if (choice === "none") return;
    // Auto shows two packs at once, each where it would sit.
    const shown: [TextGraphicStyleId, string][] =
      choice === "auto"
        ? [
            ["premium", "top-left"],
            ["note", "middle-right"],
          ]
        : [[choice, ""]];
    for (const [styleId, position] of shown) {
      const style = getTextGraphicStyle(styleId);
      const layout = layoutItems(ctx, [sampleLabel(t, position)], style, style.accent ?? DEFAULT_ACCENT, frame.width, frame.height);
      drawTextGraphicsFrame(ctx, layout, style, frame.width, frame.height, SNAPSHOT_SECONDS);
    }
  }, [choice, fontsReady, t]);

  return (
    <canvas
      ref={canvas}
      className="studio-look-frame studio-text-snapshot"
      role="img"
      aria-label={alt}
    />
  );
}

export interface TextGraphicsPreviewResult {
  plan: TextGraphicsPlan | null;
  textGraphics: ManifestTextGraphics | null;
}

/** The edit's shots on the picture timeline, for the preview player. */
function shotTimeline(document: EditorDocument) {
  const scenes = document.scenes.filter((scene) => scene.shots.length > 0);
  const windows = sceneWindows(
    scenes.map((scene) => ({
      seconds: scene.shots.reduce((sum, shot) => sum + shotPlaySeconds(shot), 0),
    })),
    DEVICE_SCENE_CROSSFADE_SECONDS
  );
  const shots: { start: number; end: number; url: string | null }[] = [];
  scenes.forEach((scene, index) => {
    let cursor = windows[index]?.start ?? 0;
    for (const shot of scene.shots) {
      const source = document.sources.find((s) => s.id === shot.sourceId);
      const seconds = shotPlaySeconds(shot);
      shots.push({
        start: cursor,
        end: cursor + seconds,
        url: source?.posterUrl ?? (source?.kind === "image" ? source.previewUrl : null),
      });
      cursor += seconds;
    }
  });
  return shots;
}

function TextGraphicsPreview({
  document,
  ratio,
  result,
}: {
  document: EditorDocument;
  ratio: string;
  result: TextGraphicsPreviewResult;
}) {
  const t = useStudioT();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const frame = frameFor(ratio);
  const cssHeight = 360;
  const cssWidth = Math.round((cssHeight * frame.width) / frame.height);
  const shots = useMemo(() => shotTimeline(document), [document]);
  const [images, setImages] = useState<(HTMLImageElement | null)[]>([]);
  const [fontsReady, setFontsReady] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(0);
  const offset = useRef(0);
  const layout = useRef<TgItemLayout[] | null>(null);
  const duration = Math.max(
    result.plan?.durationSeconds ?? 0,
    shots.length > 0 ? shots[shots.length - 1].end : 0,
    1
  );

  useEffect(() => {
    let live = true;
    void Promise.all(shots.map((shot) => loadImage(shot.url))).then((loaded) => live && setImages(loaded));
    return () => {
      live = false;
    };
  }, [shots]);

  useEffect(() => {
    let live = true;
    void loadTextGraphicFonts().then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    layout.current = null;
  }, [result, ratio, fontsReady]);

  const paint = useCallback(
    (at: number) => {
      const element = canvas.current;
      if (!element) return;
      const ctx = prepareCanvas(element, cssWidth, cssHeight, frame);
      if (!ctx) return;
      const index = shots.findIndex((shot) => at >= shot.start && at < shot.end);
      const image = images[index >= 0 ? index : shots.length - 1] ?? null;
      drawCover(ctx, image, frame.width, frame.height);
      const tg = result.textGraphics;
      if (!tg) return;
      if (!layout.current) {
        layout.current = layoutItems(ctx, tg.items, tg.style, tg.accent, frame.width, frame.height);
      }
      drawTextGraphicsFrame(ctx, layout.current, tg.style, frame.width, frame.height, at);
    },
    [cssHeight, cssWidth, frame, images, result.textGraphics, shots]
  );

  const draw = useCallback(
    (seconds: number) => {
      const at = (offset.current + seconds) % duration;
      paint(at);
      setPosition(at);
    },
    [duration, paint]
  );
  useCanvasLoop(canvas, draw, fontsReady && playing);

  useEffect(() => {
    if (!playing && fontsReady) paint(position);
  }, [fontsReady, paint, playing, position]);

  return (
    <div className="studio-text-preview">
      <canvas
        ref={canvas}
        className="studio-look-frame"
        style={{ width: cssWidth, height: cssHeight }}
        role="img"
        aria-label={t("studio.text.previewTitle")}
      />
      <div className="studio-text-preview-controls">
        <button
          type="button"
          className="studio-button"
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              offset.current = position;
              setPlaying(true);
            }
          }}
        >
          {playing ? t("studio.text.pause") : t("studio.text.play")}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={position}
          aria-label={t("studio.text.previewTitle")}
          onChange={(event) => {
            setPlaying(false);
            setPosition(Number(event.target.value));
          }}
        />
        <span className="studio-counter">
          {position.toFixed(1)} / {duration.toFixed(1)} s
        </span>
      </div>
    </div>
  );
}

export function TextStylePicker({
  document,
  ratio,
  choice,
  onChoice,
  loadPreview,
  locked,
  disabled,
}: {
  document: EditorDocument;
  ratio: string;
  choice: TextGraphicChoice;
  onChoice: (choice: TextGraphicChoice) => void;
  /** Ask the server for the real plan for this edit; null when not possible yet. */
  loadPreview: ((choice: TextGraphicChoice, fresh: boolean) => Promise<TextGraphicsPreviewResult>) | null;
  locked: boolean;
  disabled: boolean;
}) {
  const t = useStudioT();
  const [preview, setPreview] = useState<{ choice: TextGraphicChoice; result: TextGraphicsPreviewResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A preview belongs to the style it was written for, and to the edit as it was.
  useEffect(() => {
    setPreview((current) => (current && current.choice === choice ? current : null));
    setError(null);
  }, [choice]);
  useEffect(() => {
    setPreview(null);
  }, [document.scenes, document.musicTrackId]);

  const run = useCallback(
    async (fresh: boolean) => {
      if (!loadPreview || choice === "none") return;
      setLoading(true);
      setError(null);
      try {
        const result = await loadPreview(choice, fresh);
        setPreview({ choice, result });
      } catch {
        setError(t("studio.text.previewFailed"));
      } finally {
        setLoading(false);
      }
    },
    [choice, loadPreview, t]
  );

  const picked = preview?.result.plan;
  return (
    <div className="studio-text-section">
      <h3 className="studio-panel-title">{t("studio.text.title")}</h3>
      <p className="studio-panel-hint">{t("studio.text.hint")}</p>

      <div className="studio-look-grid" role="radiogroup" aria-label={t("studio.text.title")}>
        {TEXT_GRAPHIC_CHOICES.map((option) => {
          const selected = choice === option;
          const name = t(`studio.text.${option}.name`);
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || locked}
              onClick={() => onChoice(option)}
              className="studio-look"
            >
              <TextStyleExample
                choice={option}
                alt={t("studio.text.exampleAlt", { name })}
              />
              <span className="studio-look-name">
                {selected ? "✓ " : ""}
                {name}
              </span>
              <span className="studio-look-description">{t(`studio.text.${option}.description`)}</span>
            </button>
          );
        })}
      </div>

      {choice !== "none" && loadPreview && (
        <div className="studio-text-preview-box">
          <h3 className="studio-panel-title">{t("studio.text.previewTitle")}</h3>
          <p className="studio-panel-hint">{t("studio.text.previewHint")}</p>
          {preview ? (
            <>
              <TextGraphicsPreview document={document} ratio={ratio} result={preview.result} />
              {picked && choice === "auto" && (
                <p className="studio-counter" style={{ textAlign: "left" }}>
                  {t("studio.text.previewPicked", { name: t(`studio.text.${picked.styleId}.name`) })}
                </p>
              )}
              {picked?.source === "fallback" && (
                <p className="studio-counter" style={{ textAlign: "left" }}>
                  {t("studio.text.previewFallback")}
                </p>
              )}
              {!locked && (
                <button
                  type="button"
                  className="studio-button"
                  disabled={disabled || loading}
                  onClick={() => void run(true)}
                >
                  {loading ? t("studio.text.previewLoading") : t("studio.text.previewAgain")}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="studio-button"
              disabled={disabled || loading}
              onClick={() => void run(false)}
            >
              {loading ? t("studio.text.previewLoading") : t("studio.text.previewMake")}
            </button>
          )}
          {error && (
            <p className="studio-note studio-note-danger" role="alert" style={{ marginTop: 8 }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

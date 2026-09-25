/**
 * Caption and Ken Burns geometry, restated for the native renderers.
 *
 * The shipped captions are drawn by `Subtitles` in `remotion/TemplatedVideo.tsx`
 * — the server's styled render, which every delivered video comes out of — as a
 * bottom-anchored flex column of rounded plates, scaled by the SHORT side
 * (`min(width, height) / 1080`). A phone has no browser in the render path, so
 * Canvas (Android `CaptionPainter`) and Core Graphics (iOS `OverlayPainter`)
 * redraw the same layout from these numbers.
 *
 * Every length is in reference pixels. A renderer multiplies by
 * `captionScale(width, height)`. The text shadow is the one exception: it is
 * plain CSS pixels in the composition, so it is not scaled.
 *
 * Client-safe: no Node APIs, no repository imports.
 */

import type { MotionPreset } from "@/config/montage";

export type CaptionLanguage = "th" | "en" | "zh";

export interface CaptionLanguageStyle {
  /** Font stack in priority order; a native renderer takes the first it has. */
  fontFamilies: string[];
  /** Reference font size at 1080x1920. */
  fontSize: number;
  /** Fill colour, `#RRGGBB`. */
  color: string;
  /** Which field of a timed segment this language reads. */
  field: "textThai" | "textEnglish" | "textChinese";
  /** Longer than this, a cue is split into two balanced lines (`wrapCaption`). */
  maxChars: number;
}

/** Mirrors `LANG_STYLE` in `remotion/TemplatedVideo.tsx`. */
export const CAPTION_LANGUAGE_STYLES: Record<CaptionLanguage, CaptionLanguageStyle> = {
  th: {
    fontFamilies: ["Sarabun", "Noto Sans Thai", "sans-serif"],
    fontSize: 62,
    color: "#FFFFFF",
    field: "textThai",
    maxChars: 26,
  },
  en: {
    fontFamilies: ["Arial", "Helvetica", "sans-serif"],
    fontSize: 52,
    color: "#FFFFFF",
    field: "textEnglish",
    maxChars: 30,
  },
  zh: {
    fontFamilies: ["Microsoft YaHei", "Noto Sans SC", "sans-serif"],
    fontSize: 50,
    color: "#FFE066",
    field: "textChinese",
    maxChars: 16,
  },
};

/** The order languages stack in, bottom-most first. */
export const CAPTION_LANGUAGE_ORDER: CaptionLanguage[] = ["th", "en", "zh"];

export interface CaptionLayout {
  /** The short side lengths are measured against. */
  referenceShortSide: number;
  /** Distance from the frame's bottom edge to the caption stack. */
  stackBottom: number;
  /** Vertical gap between two language lines. */
  lineGap: number;
  /** Horizontal padding keeping text off the frame edges. */
  sidePadding: number;
  lineHeight: number;
  fontWeight: number;
  /** Black stroke width around the glyphs. */
  strokeWidth: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;
  shadowColor: string;
  /** Readability plate behind the text. */
  plateColor: string;
  plateRadius: number;
  platePaddingY: number;
  platePaddingX: number;
  /** Fade/pop-in length in seconds. */
  appearSeconds: number;
  appearScaleFrom: number;
}

/** Mirrors the constants and inline styles of `Subtitles` in `TemplatedVideo.tsx`. */
export const CAPTION_LAYOUT: CaptionLayout = {
  referenceShortSide: 1080,
  stackBottom: 150,
  lineGap: 16,
  sidePadding: 48,
  lineHeight: 1.22,
  fontWeight: 800,
  strokeWidth: 6,
  shadowOffsetX: 3,
  shadowOffsetY: 3,
  shadowBlur: 6,
  shadowColor: "rgba(0,0,0,0.9)",
  plateColor: "rgba(0,0,0,0.4)",
  plateRadius: 18,
  platePaddingY: 10,
  platePaddingX: 26,
  appearSeconds: 0.15,
  appearScaleFrom: 0.96,
};

/** `scale = min(width, height) / 1080` — the composition's single scaling rule. */
export function captionScale(frameWidth: number, frameHeight: number): number {
  const shortSide = Math.min(frameWidth, frameHeight);
  if (!(shortSide > 0)) return 1;
  return shortSide / CAPTION_LAYOUT.referenceShortSide;
}

/**
 * Opacity and scale of a cue at time `t`, matching the overlay's pop-in.
 * Returns `null` when no cue is showing, so a renderer can skip the pass.
 */
export function captionAppearance(
  t: number,
  startSecond: number
): { opacity: number; scale: number } {
  const p = Math.min(1, Math.max(0, (t - startSecond) / CAPTION_LAYOUT.appearSeconds));
  return {
    opacity: p,
    scale: CAPTION_LAYOUT.appearScaleFrom + (1 - CAPTION_LAYOUT.appearScaleFrom) * p,
  };
}

// ── Ken Burns ───────────────────────────────────────────────────────────────

export interface KenBurnsKeyframes {
  scaleFrom: number;
  scaleTo: number;
  /** Percent translate of the image relative to its own box. */
  translateXFrom: number;
  translateXTo: number;
  translateYFrom: number;
  translateYTo: number;
}

/**
 * Started as the table in `remotion/montageMotion.ts` `getKenBurnsKeyframes`;
 * the PHONE's moves are now deliberately bigger (1.25 zoom, 7 % pans against
 * the server's 1.12 / 4 %), because at phone sizes the server's moves read as a
 * still picture. The server path keeps its own values.
 *
 * Duplicated deliberately: the Remotion bundle is built separately and cannot
 * import from the app's module graph, and the native engines cannot import the
 * bundle. Two copies with one test asserting they agree beats a build-time
 * coupling that neither side can express.
 */
export const KEN_BURNS_KEYFRAMES: Record<MotionPreset, KenBurnsKeyframes> = {
  ken_burns_in: {
    scaleFrom: 1.0, scaleTo: 1.25,
    translateXFrom: 0, translateXTo: 0, translateYFrom: 0, translateYTo: 0,
  },
  ken_burns_out: {
    scaleFrom: 1.25, scaleTo: 1.0,
    translateXFrom: 0, translateXTo: 0, translateYFrom: 0, translateYTo: 0,
  },
  // The camera direction is opposite the image's translation: moving the
  // oversized image right reveals its left side, so the camera pans left.
  pan_left: {
    scaleFrom: 1.18, scaleTo: 1.18,
    translateXFrom: -7, translateXTo: 7, translateYFrom: 0, translateYTo: 0,
  },
  pan_right: {
    scaleFrom: 1.18, scaleTo: 1.18,
    translateXFrom: 7, translateXTo: -7, translateYFrom: 0, translateYTo: 0,
  },
  static: {
    scaleFrom: 1.0, scaleTo: 1.0,
    translateXFrom: 0, translateXTo: 0, translateYFrom: 0, translateYTo: 0,
  },
};

/**
 * Ken Burns state at `progress` (0..1 across the asset's on-screen time).
 *
 * `translate` is a fraction of the element's own box and is applied AFTER the
 * scale — the CSS order is `scale() translate()`, so a native matrix must
 * compose it the same way or the pans move by the wrong amount.
 */
export function kenBurnsAt(
  motion: MotionPreset,
  progress: number
): { scale: number; translateXFraction: number; translateYFraction: number } {
  const p = Math.min(1, Math.max(0, progress));
  const k = KEN_BURNS_KEYFRAMES[motion] ?? KEN_BURNS_KEYFRAMES.static;
  const lerp = (from: number, to: number) => from + (to - from) * p;
  return {
    scale: lerp(k.scaleFrom, k.scaleTo),
    translateXFraction: lerp(k.translateXFrom, k.translateXTo) / 100,
    translateYFraction: lerp(k.translateYFrom, k.translateYTo) / 100,
  };
}

/** Within-scene cross-dissolve length. Mirrors `TRANSITION_DURATION_SECONDS`. */
export const DEVICE_TRANSITION_SECONDS = 0.2;

/** Between-scene `xfade` length. Mirrors `concatVideosWithCrossfade`'s default. */
export const DEVICE_SCENE_CROSSFADE_SECONDS = 0.2;

/** Shortest permitted dissolve, matching `crossfadeConcatLocal`'s floor. */
export const DEVICE_MIN_CROSSFADE_SECONDS = 0.05;

/** Slowest a clip may play to fill an over-long slot. `MIN_CLIP_PLAYBACK_RATE`. */
export const DEVICE_MIN_CLIP_PLAYBACK_RATE = 0.8;

/**
 * Playback rate for a clip whose slot outruns its footage — slow it down rather
 * than freezing the last frame, clamped so the slow motion never gets extreme.
 * Mirrors `computeClipPlaybackRate`.
 */
export function devicePlaybackRate(footageSeconds: number, slotSeconds: number): number {
  if (!Number.isFinite(footageSeconds) || footageSeconds <= 0) return 1;
  if (!Number.isFinite(slotSeconds) || slotSeconds <= 0) return 1;
  if (slotSeconds <= footageSeconds) return 1;
  return Math.min(1, Math.max(DEVICE_MIN_CLIP_PLAYBACK_RATE, footageSeconds / slotSeconds));
}

/**
 * Allocate whole frames across a scene's assets in proportion to their
 * durations, every asset getting at least one frame and the last absorbing the
 * remainder. Mirrors `allocateAssetFrames`; the native engines call the same
 * shape so a scene's total length is identical on all three renderers.
 */
export function allocateDeviceFrames(
  durationsSeconds: number[],
  totalFrames: number
): { index: number; from: number; durationInFrames: number }[] {
  const n = durationsSeconds.length;
  if (n === 0) return [];

  const safeTotal = Math.max(n, Math.floor(totalFrames));
  const positive = durationsSeconds.map((d) => (Number.isFinite(d) && d > 0 ? d : 0));
  const sum = positive.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? positive.map((d) => d / sum) : positive.map(() => 1 / n);

  const ranges: { index: number; from: number; durationInFrames: number }[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let frames: number;
    if (i === n - 1) {
      frames = Math.max(1, safeTotal - acc);
    } else {
      const remainingAfter = n - 1 - i;
      const maxForThis = Math.max(1, safeTotal - acc - remainingAfter);
      frames = Math.min(maxForThis, Math.max(1, Math.round(weights[i] * safeTotal)));
    }
    ranges.push({ index: i, from: acc, durationInFrames: frames });
    acc += frames;
  }
  return ranges;
}

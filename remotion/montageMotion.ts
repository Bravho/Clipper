/**
 * Pure motion + layout math for the MontageScene composition.
 *
 * Kept free of any Remotion runtime imports so it can be unit-tested directly
 * (no headless Chromium). MontageScene.tsx consumes these helpers and feeds
 * the results into CSS transforms / <Sequence> ranges.
 */

import { MotionPreset } from "./montageTypes";

export interface KenBurnsKeyframes {
  scaleFrom: number;
  scaleTo: number;
  /** Percent translate of the element relative to its own box. */
  translateXFrom: number;
  translateXTo: number;
  translateYFrom: number;
  translateYTo: number;
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation. */
export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * Ken Burns keyframes per motion preset. Pan presets keep a slight zoom (>1)
 * so translating never exposes the frame edge.
 */
export function getKenBurnsKeyframes(motion: MotionPreset): KenBurnsKeyframes {
  switch (motion) {
    case "ken_burns_in":
      return { scaleFrom: 1.0, scaleTo: 1.12, translateXFrom: 0, translateXTo: 0, translateYFrom: 0, translateYTo: 0 };
    case "ken_burns_out":
      return { scaleFrom: 1.12, scaleTo: 1.0, translateXFrom: 0, translateXTo: 0, translateYFrom: 0, translateYTo: 0 };
    case "pan_left":
      return { scaleFrom: 1.08, scaleTo: 1.08, translateXFrom: 4, translateXTo: -4, translateYFrom: 0, translateYTo: 0 };
    case "pan_right":
      return { scaleFrom: 1.08, scaleTo: 1.08, translateXFrom: -4, translateXTo: 4, translateYFrom: 0, translateYTo: 0 };
    case "static":
    default:
      return { scaleFrom: 1.0, scaleTo: 1.0, translateXFrom: 0, translateXTo: 0, translateYFrom: 0, translateYTo: 0 };
  }
}

/**
 * Build the CSS transform string for a given motion preset at `progress`
 * (0..1 across the asset's on-screen time). `progress` is clamped internally.
 */
export function buildKenBurnsTransform(motion: MotionPreset, progress: number): string {
  const p = clamp(progress, 0, 1);
  const k = getKenBurnsKeyframes(motion);
  const scale = lerp(k.scaleFrom, k.scaleTo, p);
  const tx = lerp(k.translateXFrom, k.translateXTo, p);
  const ty = lerp(k.translateYFrom, k.translateYTo, p);
  return `scale(${round(scale)}) translate(${round(tx)}%, ${round(ty)}%)`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Slowest a clip may be played to fill a scene slot longer than its footage.
 * 0.6 ≈ at most a 1.67× stretch — enough to absorb a few seconds of shortfall
 * without looking like obvious slow-motion. Beyond this the clip plays at the
 * cap and any residual is covered by the cross-dissolve / a black tail rather
 * than a long frozen frame.
 */
export const MIN_CLIP_PLAYBACK_RATE = 0.6;

/**
 * Playback rate for a clip whose scene slot is longer than its available
 * footage: slow it down (rate < 1) to fill the slot instead of freezing the
 * last frame, clamped so the slow-motion never gets extreme. Returns 1 (normal
 * speed) when the footage length is unknown/invalid or already ≥ the slot (in
 * which case the renderer simply trims the surplus via `endAt`).
 */
export function computeClipPlaybackRate(
  footageSeconds: number,
  slotSeconds: number,
  minRate: number = MIN_CLIP_PLAYBACK_RATE
): number {
  if (!Number.isFinite(footageSeconds) || footageSeconds <= 0) return 1;
  if (!Number.isFinite(slotSeconds) || slotSeconds <= 0) return 1;
  if (slotSeconds <= footageSeconds) return 1;
  return clamp(footageSeconds / slotSeconds, minRate, 1);
}

export interface AssetFrameRange {
  index: number;
  from: number;
  durationInFrames: number;
}

/**
 * Allocate `totalFrames` across assets proportionally to each asset's
 * `durationSeconds`, guaranteeing every asset gets at least 1 frame and that
 * the ranges are contiguous and exactly cover `[0, totalFrames)`. The final
 * asset absorbs any rounding remainder so the sum is exact.
 *
 * Falls back to an even split when all durations are missing/zero.
 */
export function allocateAssetFrames(
  durationsSeconds: number[],
  totalFrames: number
): AssetFrameRange[] {
  const n = durationsSeconds.length;
  if (n === 0) return [];

  const safeTotal = Math.max(n, Math.floor(totalFrames)); // ≥1 frame per asset
  const positive = durationsSeconds.map((d) => (Number.isFinite(d) && d > 0 ? d : 0));
  const sum = positive.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? positive.map((d) => d / sum) : positive.map(() => 1 / n);

  const ranges: AssetFrameRange[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    let frames: number;
    if (isLast) {
      frames = Math.max(1, safeTotal - acc);
    } else {
      // Reserve at least 1 frame for each remaining asset after this one.
      const remainingAfter = n - 1 - i;
      const maxForThis = safeTotal - acc - remainingAfter;
      frames = clamp(Math.round(weights[i] * safeTotal), 1, Math.max(1, maxForThis));
    }
    ranges.push({ index: i, from: acc, durationInFrames: frames });
    acc += frames;
  }
  return ranges;
}

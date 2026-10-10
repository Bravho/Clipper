/**
 * The motion-template (Look) motion model — THE REFERENCE for every renderer.
 *
 * The studio preview (`templateRenderer.ts`), Android (`TemplatePainter.java`)
 * and iOS (`OverlayPainter.swift`, template section) implement exactly these
 * formulas. Change one, change all three (and tests/lib/motionTemplates).
 *
 * WHY A TIMELINE. A Look that only animates in its first second reads as a
 * static frame stuck on the video. Professional promo graphics stay alive and
 * move WITH the edit: they breathe while a shot plays, hit on every cut, and
 * close the video with a final gesture. So every renderer gets the scene cut
 * times ("beats") and the video's length (`endSeconds`) from the manifest
 * (`template.beats`, `template.endSeconds`) and drives three kinds of motion:
 *
 *   intro  — the first ~1.5 s: staggered, eased entrances (overshoot on pops)
 *   idle   — slow, low-amplitude loops (breathing, drifting, twinkling)
 *   beat   — a short accent at each scene cut, peaking at the cut itself
 *   outro  — the last ~1.3 s: a closing gesture that frames the call-to-action
 *
 * Time `t` is seconds on the finished video's timeline.
 */

export interface TemplateTimeline {
  /** Scene cut times (mid-crossfade), ascending, after 0 and before the end. */
  beats: number[];
  /** Length of the finished video; null = unknown (no progress, no outro). */
  endSeconds: number | null;
}

export const EMPTY_TIMELINE: TemplateTimeline = { beats: [], endSeconds: null };

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);

export const easeInOutCubic = (x: number): number => {
  const v = clamp01(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};

export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;

/** Back ease-out (c1 = 1.70158): overshoots ~10 % and settles. */
export function easeOutBack(x: number): number {
  const v = clamp01(x);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
}

/** Linear 0 → 1 between `start` and `start + duration`. */
export function ramp(t: number, start: number, duration: number): number {
  if (duration <= 0) return t >= start ? 1 : 0;
  return clamp01((t - start) / duration);
}

/** sin(2π (t / period + phase)). */
export function wave(t: number, period: number, phase = 0): number {
  return Math.sin(2 * Math.PI * (t / period + phase));
}

/**
 * The beat accent at `t`: 0 away from every beat, rising over `attack`
 * seconds to 1 AT the beat, then falling back to 0 over `decay` seconds.
 * Overlapping beats take the stronger value (never summed).
 */
export function beatEnvelope(t: number, beats: number[], attack: number, decay: number): number {
  let best = 0;
  for (const b of beats) {
    const d = t - b;
    let v = 0;
    if (d >= -attack && d < 0) v = easeOutCubic((d + attack) / attack);
    else if (d >= 0 && d < decay) v = 1 - easeInOutSine(d / decay);
    if (v > best) best = v;
  }
  return best;
}

/** How many scene cuts have happened by `t` — the 0-based scene index. */
export function sceneIndex(t: number, beats: number[]): number {
  let index = 0;
  for (const b of beats) if (t >= b) index++;
  return index;
}

/** Number of scenes the timeline describes (always ≥ 1). */
export function sceneCount(timeline: TemplateTimeline): number {
  return timeline.beats.length + 1;
}

/**
 * How far through the CURRENT scene `t` is, 0 → 1. The last scene ends at
 * `endSeconds`; with no end it reports 1 (treated as complete).
 */
export function sceneFraction(t: number, timeline: TemplateTimeline): number {
  const { beats, endSeconds } = timeline;
  const index = sceneIndex(t, beats);
  const start = index === 0 ? 0 : beats[index - 1];
  const end = index < beats.length ? beats[index] : endSeconds;
  if (end == null || !(end > start)) return 1;
  return clamp01((t - start) / (end - start));
}

/** Whole-video progress 0 → 1; 0 when the length is unknown. */
export function videoProgress(t: number, timeline: TemplateTimeline): number {
  const end = timeline.endSeconds;
  return end != null && end > 0 ? clamp01(t / end) : 0;
}

/** 0 → 1 over the last `length` seconds of the video; 0 with no end. */
export function outro(t: number, timeline: TemplateTimeline, length: number): number {
  const end = timeline.endSeconds;
  if (end == null || !(end > length * 1.5)) return 0;
  return ramp(t, end - length, length);
}

/**
 * The most recent beat whose window `[b - lead, b - lead + duration)` holds
 * `t`, as progress 0 → 1 through that window; -1 when none is active.
 * Used by one-shot gestures (wipes, flares, comets) that travel across a cut.
 */
export function beatProgress(t: number, beats: number[], lead: number, duration: number): number {
  let found = -1;
  for (const b of beats) {
    const start = b - lead;
    if (t >= start && t < start + duration) found = (t - start) / duration;
  }
  return found;
}

/**
 * Normalise what a manifest carries: finite, ascending, strictly inside
 * (0.3 s, end − 0.3 s) so an accent never lands on the first or last frame.
 */
export function normaliseTimeline(
  beats: unknown,
  endSeconds: unknown
): TemplateTimeline {
  const end = typeof endSeconds === "number" && Number.isFinite(endSeconds) && endSeconds > 0
    ? endSeconds
    : null;
  const list = Array.isArray(beats) ? beats : [];
  const clean = list
    .filter((b): b is number => typeof b === "number" && Number.isFinite(b))
    .filter((b) => b > 0.3 && (end == null || b < end - 0.3))
    .sort((a, b) => a - b);
  return { beats: clean, endSeconds: end };
}

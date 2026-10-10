/**
 * The text-graphics motion model — THE REFERENCE for every renderer.
 *
 * The studio preview (`canvasRenderer.ts`), Android (`TextGraphicsPainter.java`)
 * and iOS (`TextGraphicsLayers.swift`) all implement exactly these formulas.
 * Change one, change all three (and the tests in tests/lib/textGraphics).
 *
 * Time is LOCAL to the item: `lt = t - item.start`, in seconds.
 */
import type {
  TextGraphicAnim,
  TextGraphicExit,
  TextGraphicIdle,
} from "@/config/textGraphicStyles";

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Cubic ease-out: fast start, gentle landing. */
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

/** Cubic ease-in: used for exits. */
export const easeInCubic = (x: number): number => x * x * x;

/** Back ease-out with overshoot (c1 = 1.9), used by pop and drop. */
export function easeBack(x: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Linear progress of an enter animation at local time `lt`. */
export function enterProgress(anim: TextGraphicAnim, lt: number): number {
  if (anim.dur <= 0) return lt >= anim.delay ? 1 : 0;
  return clamp01((lt - anim.delay) / anim.dur);
}

/** The eased value the enter kind uses. */
export function enterEase(anim: TextGraphicAnim, p: number): number {
  return anim.kind === "pop" || anim.kind === "drop" ? easeBack(p) : easeOutCubic(p);
}

/**
 * What an enter animation does to its part, for a renderer to apply.
 *
 *   translateY  in reference px (multiply by the frame scale), EXCEPT `rise`,
 *               whose shift is `riseFraction` of the part's own height
 *   scaleX/Y    about the part's anchor
 *   alpha       multiplies the part's (and its children's) opacity
 *   clipRight   for `wipe`: fraction of the part's width that is revealed
 */
export interface EnterState {
  visible: boolean;
  translateY: number;
  riseFraction: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  clipRight: number;
  clipToSelf: boolean;
}

export function enterState(anim: TextGraphicAnim | null, lt: number): EnterState {
  const base: EnterState = {
    visible: true,
    translateY: 0,
    riseFraction: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    clipRight: 1,
    clipToSelf: false,
  };
  if (!anim) return base;
  const p = enterProgress(anim, lt);
  if (p <= 0) return { ...base, visible: false };
  const e = enterEase(anim, p);
  switch (anim.kind) {
    case "rise":
      return { ...base, riseFraction: (1 - e) * 1.15, clipToSelf: true };
    case "wipe":
      return { ...base, clipRight: e };
    case "pop":
      return { ...base, scaleX: e, scaleY: e, alpha: Math.min(1, p * 4) };
    case "fade":
      return { ...base, alpha: e, translateY: (1 - e) * 16 };
    case "growX":
      return { ...base, scaleX: e };
    case "growY":
      return { ...base, scaleY: e };
    case "drop":
      return { ...base, translateY: -(1 - e) * 40, alpha: Math.min(1, p * 4) };
    default:
      return base;
  }
}

/** When the idle loop of a part starts: 1 s in, or when its enter ends, whichever is later. */
export function idleStart(anim: TextGraphicAnim | null): number {
  return Math.max(1.0, anim ? anim.delay + anim.dur : 0);
}

/**
 * The idle loop: rotation (deg), vertical offset (reference px) and a scale
 * multiplier, all about the part's centre. Zero before `idleStart`.
 */
export function idleState(
  idle: TextGraphicIdle | undefined,
  anim: TextGraphicAnim | null,
  lt: number
): { rotateDeg: number; translateY: number; scale: number } {
  const none = { rotateDeg: 0, translateY: 0, scale: 1 };
  if (!idle || idle.kind === "none" || idle.period <= 0) return none;
  const tau = lt - idleStart(anim);
  if (tau <= 0) return none;
  const wave = Math.sin((2 * Math.PI * tau) / idle.period);
  switch (idle.kind) {
    case "wobble":
      return { ...none, rotateDeg: idle.amp * wave };
    case "float":
      return { ...none, translateY: idle.amp * wave };
    case "pulse":
      return { ...none, scale: 1 + idle.amp * wave };
    default:
      return none;
  }
}

/**
 * The exit applied to the whole item over its last `exit.dur` seconds:
 * horizontal shift (reference px), scale about the item's anchor, alpha.
 */
export function exitState(
  exit: TextGraphicExit,
  t: number,
  end: number
): { translateX: number; scale: number; alpha: number } {
  const o = exit.dur > 0 ? clamp01((t - (end - exit.dur)) / exit.dur) : t >= end ? 1 : 0;
  const eo = easeInCubic(o);
  switch (exit.kind) {
    case "slideLeft":
      return { translateX: -40 * eo, scale: 1, alpha: 1 - eo };
    case "shrink":
      return { translateX: 0, scale: 1 - 0.15 * eo, alpha: 1 - eo };
    case "fade":
    default:
      return { translateX: 0, scale: 1, alpha: 1 - o };
  }
}

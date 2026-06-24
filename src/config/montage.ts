/**
 * Real-media montage configuration (Phase 1).
 *
 * The montage engine animates the client's actual uploaded photos/clips with
 * Ken Burns motion, cuts, and transitions — replacing the Veo generative-video
 * core for the default pipeline. This module is the single app-side source of
 * truth for the montage asset shape and motion vocabulary.
 *
 * NOTE: the Remotion bundle (built separately via @remotion/bundler) cannot
 * import from the Next.js path-aliased module graph, so `remotion/montageTypes.ts`
 * intentionally mirrors these shapes. `src/lib/ai/montageService.ts` maps the
 * app-side specs onto the Remotion input props. This mirrors the existing
 * pattern between `src/lib/ai/*` and `remotion/types.ts`.
 *
 * Upload limits (per-clip duration, total request size) live with the other
 * upload constraints in `src/domain/enums/AssetType.ts` (shipped in Phase 0):
 * MAX_CLIP_DURATION_SECONDS and MAX_UPLOAD_SIZE_BYTES.
 */

/** Per-asset camera motion applied to stills (and optionally clips). */
export type MotionPreset =
  | "ken_burns_in"
  | "ken_burns_out"
  | "pan_left"
  | "pan_right"
  | "static";

/** Transition applied between assets within a scene. */
export type MontageTransition = "cut" | "fade" | "slide" | "zoom";

export const MOTION_PRESETS: MotionPreset[] = [
  "ken_burns_in",
  "ken_burns_out",
  "pan_left",
  "pan_right",
  "static",
];

export const MONTAGE_TRANSITIONS: MontageTransition[] = [
  "cut",
  "fade",
  "slide",
  "zoom",
];

export const DEFAULT_MOTION_PRESET: MotionPreset = "ken_burns_in";
export const DEFAULT_MONTAGE_TRANSITION: MontageTransition = "fade";

/**
 * Frame rate for montage renders. Must match the Remotion overlay FPS
 * (`remotion/types.ts` FPS) and the FFmpeg composition step's expectations so
 * segments concat cleanly.
 */
export const MONTAGE_FPS = 30;

/** Transition duration in seconds (fade/slide ramp at the start of an asset). */
export const TRANSITION_DURATION_SECONDS = 0.3;

/**
 * One real-media asset within a montage scene. `url` is a publicly readable
 * DO Spaces URL of the uploaded photo/clip. For clips, `trimStartSeconds` /
 * `trimEndSeconds` select the portion to play; `focusX`/`focusY` (0..1) steer
 * Ken Burns / crop focus toward the subject (e.g. the dish or signage).
 */
export interface MontageAssetSpec {
  url: string;
  kind: "image" | "clip";
  motion: MotionPreset;
  durationSeconds: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  focusX?: number;
  focusY?: number;
}

export function isMotionPreset(value: unknown): value is MotionPreset {
  return typeof value === "string" && (MOTION_PRESETS as string[]).includes(value);
}

export function isMontageTransition(value: unknown): value is MontageTransition {
  return typeof value === "string" && (MONTAGE_TRANSITIONS as string[]).includes(value);
}

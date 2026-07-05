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

/** Transition duration in seconds (very short cross-dissolve between shots). */
export const TRANSITION_DURATION_SECONDS = 0.2;

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

/**
 * Short music-only intro before the voiceover starts. Mirrors
 * `ffmpegService.MUSIC_LEAD_IN_SECONDS` (0.6s) — kept here as a client-safe
 * constant so the scene-design panel can compute the minimum montage length
 * without importing the server-only ffmpeg module.
 */
export const MONTAGE_INTRO_SECONDS = 0.6;

/**
 * Short tail after the narration ends so the last spoken word isn't cut at the
 * very edge of the video. The compose step freezes the final frame a little
 * longer than this, but the montage itself should still cover it.
 */
export const MONTAGE_ENDING_SECONDS = 1.0;

/**
 * Minimum acceptable total montage length: the approved voice length plus the
 * short music intro and ending tail. The requester's scenes (stills included)
 * must sum to at least this so narration is always fully covered by picture.
 */
export function minMontageTotalSeconds(voiceDurationSeconds: number | null | undefined): number {
  const voice =
    Number.isFinite(voiceDurationSeconds) && (voiceDurationSeconds as number) > 0
      ? (voiceDurationSeconds as number)
      : 0;
  return voice + MONTAGE_INTRO_SECONDS + MONTAGE_ENDING_SECONDS;
}

/**
 * On-screen seconds a single montage asset occupies. For a trimmed clip this is
 * its selected window (out − in); otherwise its explicit `durationSeconds`.
 * Used by the editor and the approval gate so a clip's play time follows its
 * trim handles.
 */
export function assetPlaySeconds(asset: {
  kind: "image" | "clip";
  durationSeconds?: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
}): number {
  if (
    asset.kind === "clip" &&
    Number.isFinite(asset.trimStartSeconds) &&
    Number.isFinite(asset.trimEndSeconds) &&
    (asset.trimEndSeconds as number) > (asset.trimStartSeconds as number)
  ) {
    return (asset.trimEndSeconds as number) - (asset.trimStartSeconds as number);
  }
  return Number.isFinite(asset.durationSeconds) && (asset.durationSeconds as number) > 0
    ? (asset.durationSeconds as number)
    : 0;
}

/** Sum a scene's on-screen length: Σ per-asset play seconds, else scene.durationSeconds. */
export function sceneMontageSeconds(scene: {
  durationSeconds?: number;
  assets?: Array<Parameters<typeof assetPlaySeconds>[0]>;
}): number {
  if (scene.assets && scene.assets.length > 0) {
    return scene.assets.reduce((sum, a) => sum + assetPlaySeconds(a), 0);
  }
  return Number.isFinite(scene.durationSeconds) && (scene.durationSeconds as number) > 0
    ? (scene.durationSeconds as number)
    : 0;
}

export function isMotionPreset(value: unknown): value is MotionPreset {
  return typeof value === "string" && (MOTION_PRESETS as string[]).includes(value);
}

export function isMontageTransition(value: unknown): value is MontageTransition {
  return typeof value === "string" && (MONTAGE_TRANSITIONS as string[]).includes(value);
}

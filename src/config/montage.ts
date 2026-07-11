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

import { MAX_CLIP_DURATION_SECONDS } from "@/domain/enums/AssetType";

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
 * How much LONGER the voiceover may run than the total montage picture before
 * the merge is hard-blocked. Up to this much shortage is tolerated: the leftover
 * (picture-less) period is filled with a black scene while the voice + music keep
 * playing. Beyond it, the frozen/black tail would dominate the clip, so the
 * requester is required to lengthen the scenes or regenerate a shorter voiceover.
 */
export const MAX_VOICE_OVER_SHORTAGE_SECONDS = 10;

/**
 * Seconds each uploaded still is assumed to hold on screen when estimating a
 * suggested voiceover length before any scene plan exists (the first voice
 * step). Clips are counted at their real footage length instead.
 */
export const SUGGESTED_SECONDS_PER_IMAGE = 5;

/**
 * Grace beyond the suggested voiceover length before the first voice step blocks
 * approval. A voice up to this much longer than {@link estimateSuggestedVoiceSeconds}
 * is allowed (the extra is absorbed by slower clips / a short black tail); longer
 * than this and the requester must shorten the script and regenerate.
 */
export const VOICE_OVER_SUGGESTION_TOLERANCE_SECONDS = 10;

/**
 * Estimate a suggested MAXIMUM voiceover length from the uploaded source media,
 * before any scene plan exists. Clips contribute their real footage length; each
 * still contributes {@link SUGGESTED_SECONDS_PER_IMAGE}. This is the length the
 * pictures can comfortably cover, so a voiceover near or below it needs little to
 * no filler. Returns 0 when there is no usable media.
 */
export function estimateSuggestedVoiceSeconds(params: {
  imageCount: number;
  clipSecondsTotal: number;
}): number {
  const images =
    Number.isFinite(params.imageCount) && params.imageCount > 0 ? Math.floor(params.imageCount) : 0;
  const clips =
    Number.isFinite(params.clipSecondsTotal) && params.clipSecondsTotal > 0
      ? params.clipSecondsTotal
      : 0;
  return clips + images * SUGGESTED_SECONDS_PER_IMAGE;
}

/**
 * Pre-voice on-screen estimate for a single storyboard asset (still or clip),
 * shown as a RANGE while the rough storyboard is being reviewed — before any real
 * per-asset timing exists. The upper bound aligns with
 * {@link SUGGESTED_SECONDS_PER_IMAGE} (the comfortable hold for a still).
 */
export const ESTIMATED_SCENE_SECONDS_PER_ASSET_MIN = 3;
export const ESTIMATED_SCENE_SECONDS_PER_ASSET_MAX = SUGGESTED_SECONDS_PER_IMAGE; // 5

/** A rough duration estimate expressed as an inclusive [min, max] second range. */
export interface DurationRange {
  minSeconds: number;
  maxSeconds: number;
}

/**
 * Minimal asset shape needed to estimate on-screen time: its kind and, for a
 * clip, its real probed length. Both {@link OrderedSourceAsset} and the
 * storyboard thumbnail shape are assignable to this.
 */
export interface EstimateAsset {
  kind: "image" | "clip";
  /** Real clip length (seconds); ignored for images, may be null/absent. */
  durationSeconds?: number | null;
}

/**
 * Estimated on-screen duration range for a SINGLE asset:
 *  - Image → a flat {@link ESTIMATED_SCENE_SECONDS_PER_ASSET_MIN}–
 *    {@link ESTIMATED_SCENE_SECONDS_PER_ASSET_MAX}s hold.
 *  - Clip with a known length → its real (max) length as a fixed point range,
 *    capped at {@link MAX_CLIP_DURATION_SECONDS}.
 *  - Clip with an unknown length → falls back to the flat image estimate.
 * A missing/invalid asset contributes nothing (a zeroed range).
 */
export function estimateAssetDurationRange(
  asset: EstimateAsset | null | undefined
): DurationRange {
  if (!asset) return { minSeconds: 0, maxSeconds: 0 };
  if (asset.kind === "clip") {
    const d = Number(asset.durationSeconds);
    if (Number.isFinite(d) && d > 0) {
      const secs = Math.max(1, Math.round(Math.min(d, MAX_CLIP_DURATION_SECONDS)));
      return { minSeconds: secs, maxSeconds: secs };
    }
  }
  return {
    minSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MIN,
    maxSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MAX,
  };
}

/**
 * Estimated on-screen duration range for one storyboard scene, summing
 * {@link estimateAssetDurationRange} over the photos/clips it draws from.
 * Returns a zeroed range for an empty scene.
 */
export function estimateSceneDurationRange(
  assets: Array<EstimateAsset | null | undefined>
): DurationRange {
  return (Array.isArray(assets) ? assets : []).reduce<DurationRange>(
    (acc, a) => {
      const r = estimateAssetDurationRange(a);
      return {
        minSeconds: acc.minSeconds + r.minSeconds,
        maxSeconds: acc.maxSeconds + r.maxSeconds,
      };
    },
    { minSeconds: 0, maxSeconds: 0 }
  );
}

/**
 * Estimated total video length range, summing {@link estimateSceneDurationRange}
 * over every storyboard scene (pass each scene's resolved asset list). Returns a
 * zeroed range when there are no scenes/assets.
 */
export function estimateStoryboardTotalRange(
  scenes: Array<Array<EstimateAsset | null | undefined>>
): DurationRange {
  return (Array.isArray(scenes) ? scenes : []).reduce<DurationRange>(
    (acc, sceneAssets) => {
      const r = estimateSceneDurationRange(sceneAssets);
      return {
        minSeconds: acc.minSeconds + r.minSeconds,
        maxSeconds: acc.maxSeconds + r.maxSeconds,
      };
    },
    { minSeconds: 0, maxSeconds: 0 }
  );
}

/**
 * Suggested speaking-voice length range for the voice step, derived from the
 * estimated total video length. The voiceover must fit inside the picture with a
 * short music intro and ending tail, so the suggestion is always SHORTER than the
 * total: its maximum sits {@link MONTAGE_INTRO_SECONDS} + {@link MONTAGE_ENDING_SECONDS}
 * below the total's LOWER bound (guaranteeing the voice fits even the shortest
 * estimate). Returns a zeroed range when there is no usable estimate.
 */
export function suggestVoiceDurationRange(total: DurationRange): DurationRange {
  const totalMin =
    total && Number.isFinite(total.minSeconds) && total.minSeconds > 0 ? total.minSeconds : 0;
  if (totalMin <= 0) return { minSeconds: 0, maxSeconds: 0 };
  const headroom = MONTAGE_INTRO_SECONDS + MONTAGE_ENDING_SECONDS; // 1.6s
  let maxSeconds = Math.max(1, Math.round(totalMin - headroom));
  // Guarantee the suggestion is STRICTLY shorter than the total (the floor above
  // can otherwise tie a tiny total). Too small to suggest anything → no range.
  if (maxSeconds >= totalMin) maxSeconds = totalMin - 1;
  if (maxSeconds < 1) return { minSeconds: 0, maxSeconds: 0 };
  const minSeconds = Math.max(1, Math.round(maxSeconds * 0.7));
  return { minSeconds: Math.min(minSeconds, maxSeconds), maxSeconds };
}

/**
 * How much the voiceover exceeds the total montage picture length (0 when the
 * picture already covers the voice). Used by the scene-design merge gate.
 */
export function voiceOverShortageSeconds(
  totalSceneSeconds: number,
  voiceDurationSeconds: number | null | undefined
): number {
  const voice =
    Number.isFinite(voiceDurationSeconds) && (voiceDurationSeconds as number) > 0
      ? (voiceDurationSeconds as number)
      : 0;
  const picture = Number.isFinite(totalSceneSeconds) && totalSceneSeconds > 0 ? totalSceneSeconds : 0;
  return Math.max(0, voice - picture);
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

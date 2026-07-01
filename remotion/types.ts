/**
 * Local type definitions for the Remotion overlay-rendering project
 * (Phase 4 — multi-ratio motion-graphics/caption overlays).
 *
 * These intentionally mirror (but do not import from) the shapes defined in
 * `src/lib/ai/geminiSubtitlesService.ts` (`TimedSegment`),
 * `src/lib/ai/animationService.ts` (`AnimationSpec`), and
 * `src/domain/models/VideoGenerationJob.ts` (`ScenePlan`) so that the
 * Remotion bundle (built separately via `@remotion/bundler`) has no
 * dependency on the Next.js app's path aliases / module graph.
 *
 * `src/lib/ai/remotionService.ts` is responsible for mapping the real
 * domain types onto these shapes when building `inputProps`.
 */

export interface TimedSegment {
  sentenceNumber: number;
  textThai: string;
  textEnglish: string;
  textChinese?: string;
  startSecond: number;
  endSecond: number;
}

export type AnimationType = "kinetic_text" | "lower_third" | "cta_banner";
export type AnimationEffect = "fade_in" | "fade_slide_up" | "slide_in_left";

export interface AnimationSpec {
  startMs: number;
  endMs: number;
  type: AnimationType;
  text: string;
  effect: AnimationEffect;
}

export interface ScenePlanEntry {
  sceneNumber: number;
  durationSeconds: number;
  visualDescriptionThai?: string;
  imageIndexes?: number[];
}

export type VideoRatio = "9:16" | "16:9" | "1:1" | "4:5";

export const RATIO_DIMENSIONS: Record<VideoRatio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

/** Frame rate used for all overlay renders — must match the FFmpeg composition step's expectations. */
export const FPS = 30;

/** Brand/content-derived palette for the decorative motion-graphics layer. */
export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
}

export const DEFAULT_PALETTE: Palette = {
  primary: "#FF6B35",
  secondary: "#FFB703",
  accent: "#06D6A0",
  neutral: "#FFFFFF",
};

export interface OverlayInputProps {
  ratio: VideoRatio;
  durationSeconds: number;
  subtitleTimeline: TimedSegment[];
  subtitleLanguages: ("th" | "en" | "zh")[];
  scenePlan: ScenePlanEntry[];
  animationSpecs: AnimationSpec[];
  /** Palette for the decorative shapes (waves/triangles/blobs/sparkles). */
  palette: Palette;
}

export const DEFAULT_OVERLAY_PROPS: OverlayInputProps = {
  ratio: "9:16",
  durationSeconds: 15,
  subtitleTimeline: [],
  subtitleLanguages: ["en", "zh"],
  scenePlan: [],
  animationSpecs: [],
  palette: DEFAULT_PALETTE,
};

/**
 * Phase 7 (template redesign) — single-pass styled render: the merged master
 * video is placed INSIDE this composition (via OffthreadVideo, which carries its
 * voice+music audio), with the chosen template's frame/decor + subtitles drawn
 * around it, output as an opaque MP4. No alpha compositing (fixes the black bug).
 */
export interface TemplatedVideoInputProps {
  /** Public URL of the merged (voice+music) master for this ratio. */
  masterUrl: string;
  ratio: VideoRatio;
  durationSeconds: number;
  /** Template id from src/config/motionTemplates.ts ("none" | "clean_frame" | …). */
  templateId: string;
  palette: Palette;
  subtitleTimeline: TimedSegment[];
  subtitleLanguages: ("th" | "en" | "zh")[];
}

export const DEFAULT_TEMPLATED_VIDEO_PROPS: TemplatedVideoInputProps = {
  masterUrl: "",
  ratio: "9:16",
  durationSeconds: 15,
  templateId: "none",
  palette: DEFAULT_PALETTE,
  subtitleTimeline: [],
  subtitleLanguages: ["en", "zh"],
};

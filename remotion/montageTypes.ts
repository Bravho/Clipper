/**
 * Bundle-local types for the Remotion MontageScene composition (Phase 1).
 *
 * These intentionally mirror (but do not import from) the app-side shapes in
 * `src/config/montage.ts`, because the Remotion bundle is built separately via
 * `@remotion/bundler` and has no access to the Next.js path aliases / module
 * graph. `src/lib/ai/montageService.ts` maps the app types onto these when
 * building `inputProps`. Same pattern as `remotion/types.ts`.
 */

import { RATIO_DIMENSIONS, FPS, VideoRatio } from "./types";

export type { VideoRatio };
export { RATIO_DIMENSIONS, FPS };

export type MotionPreset =
  | "ken_burns_in"
  | "ken_burns_out"
  | "pan_left"
  | "pan_right"
  | "static";

export type MontageTransition = "cut" | "fade" | "slide" | "zoom";

export interface MontageAsset {
  url: string;
  kind: "image" | "clip";
  motion: MotionPreset;
  durationSeconds: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  focusX?: number;
  focusY?: number;
}

export interface MontageSceneInputProps {
  ratio: VideoRatio;
  durationSeconds: number;
  assets: MontageAsset[];
  transition: MontageTransition;
}

export const DEFAULT_MONTAGE_SCENE_PROPS: MontageSceneInputProps = {
  ratio: "9:16",
  durationSeconds: 5,
  assets: [],
  transition: "fade",
};

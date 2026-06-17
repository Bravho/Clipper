import React from "react";
import { AbsoluteFill } from "remotion";
import { CaptionOverlay } from "./CaptionOverlay";
import { SceneLowerThird } from "./SceneLowerThird";
import { OverlayInputProps } from "./types";

/**
 * Root Phase-4 overlay composition: a transparent (alpha-channel) frame
 * containing kinetic captions (from `subtitleTimeline`/`subtitleLanguages`)
 * and scene motion-graphics (from `animationSpecs`). Rendered once per
 * required aspect ratio by `src/lib/ai/remotionService.ts`, then composited
 * onto the concatenated Kling base video via FFmpeg's `overlay` filter.
 *
 * `scenePlan` is accepted for forward-compatibility with future
 * scene-transition templates but is not yet rendered directly.
 */
export function OverlayComposition(props: OverlayInputProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <SceneLowerThird animationSpecs={props.animationSpecs} />
      <CaptionOverlay subtitleTimeline={props.subtitleTimeline} subtitleLanguages={props.subtitleLanguages} />
    </AbsoluteFill>
  );
}

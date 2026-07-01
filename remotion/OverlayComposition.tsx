import React from "react";
import { AbsoluteFill } from "remotion";
import { CaptionOverlay } from "./CaptionOverlay";
import { SceneLowerThird } from "./SceneLowerThird";
import { DecorativeGraphics } from "./DecorativeGraphics";
import { DEFAULT_PALETTE, OverlayInputProps } from "./types";

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
      {/* Back layer: lively decorative shapes (edge/corner-weighted). */}
      <DecorativeGraphics palette={props.palette ?? DEFAULT_PALETTE} scenePlan={props.scenePlan} />
      {/* Mid layer: English text motion graphics. */}
      <SceneLowerThird animationSpecs={props.animationSpecs} />
      {/* Front layer: subtitles on top, always legible. */}
      <CaptionOverlay subtitleTimeline={props.subtitleTimeline} subtitleLanguages={props.subtitleLanguages} />
    </AbsoluteFill>
  );
}

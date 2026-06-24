import React from "react";
import { Composition } from "remotion";
import { OverlayComposition } from "./OverlayComposition";
import { DEFAULT_OVERLAY_PROPS, FPS, OverlayInputProps, RATIO_DIMENSIONS } from "./types";
import { MontageScene } from "./MontageScene";
import { DEFAULT_MONTAGE_SCENE_PROPS, MontageSceneInputProps } from "./montageTypes";

/**
 * Registers the "Overlay" composition used by
 * `src/lib/ai/remotionService.ts#renderOverlay()`. Width/height/duration are
 * computed per-render from `inputProps.ratio` / `inputProps.durationSeconds`
 * via `calculateMetadata`, so one composition definition covers all four
 * required export ratios (9:16, 16:9, 1:1, 4:5).
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Overlay"
        component={OverlayComposition as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={FPS * DEFAULT_OVERLAY_PROPS.durationSeconds}
        fps={FPS}
        width={RATIO_DIMENSIONS["9:16"].width}
        height={RATIO_DIMENSIONS["9:16"].height}
        defaultProps={DEFAULT_OVERLAY_PROPS as unknown as Record<string, unknown>}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => {
          const typedProps = props as unknown as OverlayInputProps;
          const dims = RATIO_DIMENSIONS[typedProps.ratio] ?? RATIO_DIMENSIONS["9:16"];
          const durationSeconds = typedProps.durationSeconds > 0 ? typedProps.durationSeconds : DEFAULT_OVERLAY_PROPS.durationSeconds;
          return {
            width: dims.width,
            height: dims.height,
            durationInFrames: Math.max(1, Math.round(durationSeconds * FPS)),
            fps: FPS,
          };
        }}
      />

      {/* Phase 1 — real-media montage. One scene segment per render; width/
          height/duration computed per-render from inputProps.ratio /
          .durationSeconds, so one definition covers all export ratios. */}
      <Composition
        id="MontageScene"
        component={MontageScene as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={FPS * DEFAULT_MONTAGE_SCENE_PROPS.durationSeconds}
        fps={FPS}
        width={RATIO_DIMENSIONS["9:16"].width}
        height={RATIO_DIMENSIONS["9:16"].height}
        defaultProps={DEFAULT_MONTAGE_SCENE_PROPS as unknown as Record<string, unknown>}
        calculateMetadata={async ({ props }: { props: Record<string, unknown> }) => {
          const typedProps = props as unknown as MontageSceneInputProps;
          const dims = RATIO_DIMENSIONS[typedProps.ratio] ?? RATIO_DIMENSIONS["9:16"];
          const durationSeconds =
            typedProps.durationSeconds > 0
              ? typedProps.durationSeconds
              : DEFAULT_MONTAGE_SCENE_PROPS.durationSeconds;
          return {
            width: dims.width,
            height: dims.height,
            durationInFrames: Math.max(1, Math.round(durationSeconds * FPS)),
            fps: FPS,
          };
        }}
      />
    </>
  );
};

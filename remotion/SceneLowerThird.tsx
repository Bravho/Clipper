import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimationSpec, OverlayInputProps } from "./types";

const FADE_MS = 300;

/**
 * Renders motion-graphics overlays (kinetic hook text, lower-third product
 * callouts, CTA banners) driven by `animationSpecs` — the same
 * `AnimationSpec[]` previously burned in via FFmpeg `drawtext`
 * (`src/lib/ai/animationService.ts`), now rendered as animated React/CSS
 * elements on a transparent Remotion frame.
 *
 * Positions/sizes are defined at the 1080x1920 reference frame and scaled
 * by `height / 1920` for other aspect ratios.
 */
export function SceneLowerThird({ animationSpecs }: Pick<OverlayInputProps, "animationSpecs">) {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const tMs = (frame / fps) * 1000;
  const scale = height / 1920;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {animationSpecs.map((spec, i) => {
        if (tMs < spec.startMs - FADE_MS || tMs > spec.endMs + FADE_MS) return null;

        const opacity = interpolate(
          tMs,
          [spec.startMs - FADE_MS, spec.startMs, spec.endMs, spec.endMs + FADE_MS],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const baseStyle: React.CSSProperties = {
          position: "absolute",
          fontFamily: "'Sarabun', 'Noto Sans Thai', Arial, sans-serif",
          fontWeight: 800,
          color: "white",
          textShadow: "2px 2px 6px rgba(0,0,0,0.85)",
          WebkitTextStroke: `${3 * scale}px black`,
          opacity,
        };

        const style = lowerThirdStyle(spec, baseStyle, scale, width, tMs);

        return (
          <div key={`${spec.type}-${i}`} style={style}>
            {spec.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function lowerThirdStyle(
  spec: AnimationSpec,
  base: React.CSSProperties,
  scale: number,
  width: number,
  tMs: number
): React.CSSProperties {
  switch (spec.type) {
    case "kinetic_text": {
      const slideUp =
        spec.effect === "fade_slide_up"
          ? interpolate(tMs, [spec.startMs - FADE_MS, spec.startMs], [60 * scale, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          : 0;
      return {
        ...base,
        top: "50%",
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 72 * scale,
        transform: `translateY(calc(-50% + ${slideUp}px))`,
      };
    }
    case "lower_third": {
      const slideX =
        spec.effect === "slide_in_left"
          ? interpolate(tMs, [spec.startMs - FADE_MS, spec.startMs], [-width, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          : 0;
      return {
        ...base,
        bottom: 160 * scale,
        left: 80 * scale + slideX,
        fontSize: 52 * scale,
      };
    }
    case "cta_banner":
    default:
      return {
        ...base,
        bottom: 80 * scale,
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 58 * scale,
        color: "#FFD700",
      };
  }
}

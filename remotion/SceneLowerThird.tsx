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
      // Slight overshoot scale-in for a punchy hook.
      const pop = interpolate(
        tMs,
        [spec.startMs - FADE_MS, spec.startMs, spec.startMs + 120],
        [0.82, 1.04, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      );
      return {
        ...base,
        top: "44%",
        left: 0,
        right: 0,
        textAlign: "center",
        padding: `0 ${60 * scale}px`,
        fontSize: 76 * scale,
        letterSpacing: `${0.5 * scale}px`,
        transform: `translateY(calc(-50% + ${slideUp}px)) scale(${pop})`,
        transformOrigin: "center",
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
      // Sit above the bottom subtitle stack (captions occupy ~100-340px), with
      // an accent bar + pill so it reads as a designed graphic, not floating text.
      return {
        ...base,
        bottom: 380 * scale,
        left: 80 * scale + slideX,
        fontSize: 52 * scale,
        paddingLeft: `${22 * scale}px`,
        paddingRight: `${26 * scale}px`,
        paddingTop: `${10 * scale}px`,
        paddingBottom: `${10 * scale}px`,
        borderLeft: `${8 * scale}px solid #FFD700`,
        borderRadius: `${10 * scale}px`,
        background: "rgba(0,0,0,0.45)",
      };
    }
    case "cta_banner":
    default:
      // Solid high-contrast pill, centered above the subtitle stack — reads as a
      // call-to-action button rather than plain text.
      return {
        ...base,
        bottom: 480 * scale,
        left: "50%",
        transform: "translateX(-50%)",
        textAlign: "center",
        fontSize: 58 * scale,
        color: "#1A1A1A",
        WebkitTextStroke: "0px",
        textShadow: "none",
        background: "#FFD700",
        borderRadius: "999px",
        padding: `${14 * scale}px ${40 * scale}px`,
      };
  }
}

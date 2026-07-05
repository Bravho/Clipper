import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { OverlayInputProps, TimedSegment } from "./types";

/**
 * Per-language caption styling, mirroring the ASS styles defined in
 * `src/lib/ai/geminiSubtitlesService.ts` (ThaiStyle/EngStyle/ChiStyle):
 *   ThaiStyle: 52px, white, MarginV=300
 *   EngStyle:  48px, white, MarginV=200
 *   ChiStyle:  42px, yellow, MarginV=100
 *
 * `bottom` values below are those MarginV numbers (pixels, at the 1080x1920
 * reference frame) and are scaled by `height / 1920` for other ratios.
 */
const LANG_STYLE: Record<
  "th" | "en" | "zh",
  { fontFamily: string; color: string; fontSize: number; field: keyof TimedSegment }
> = {
  // Large/bold, phone-first sizes (1080x1920 reference; scaled per ratio).
  th: { fontFamily: "'Sarabun', 'Noto Sans Thai', sans-serif", color: "#FFFFFF", fontSize: 72, field: "textThai" },
  en: { fontFamily: "Arial, Helvetica, sans-serif", color: "#FFFFFF", fontSize: 64, field: "textEnglish" },
  zh: { fontFamily: "'Microsoft YaHei', 'Noto Sans SC', sans-serif", color: "#FFFF00", fontSize: 58, field: "textChinese" },
};

/** Distance of the whole caption stack from the bottom edge (1080x1920 ref). */
const STACK_BOTTOM = 150;
/** Max wrapped lines per language line before clamping (safety net). */
const MAX_LINES_PER_CUE = 2;

/**
 * Renders the kinetic-captions overlay: for the currently active
 * `TimedSegment` (driven by `subtitleTimeline`, real voice timing), shows
 * one line per requested `subtitleLanguages` entry, stacked from the bottom
 * in Thai/English/Chinese order matching the ASS subtitle layering used in
 * the final FFmpeg composition step (for ratios NOT covered by this
 * overlay).
 */
export function CaptionOverlay({
  subtitleTimeline,
  subtitleLanguages,
}: Pick<OverlayInputProps, "subtitleTimeline" | "subtitleLanguages">) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const scale = height / 1920;

  const active = subtitleTimeline.find((s) => t >= s.startSecond && t <= s.endSecond);
  if (!active) return null;

  // Subtle pop-in as each caption appears (first ~150ms of the segment), so
  // captions feel kinetic rather than hard-cutting on/off.
  const appear = Math.min(1, Math.max(0, (t - active.startSecond) / 0.15));
  const popScale = 0.96 + 0.04 * appear;

  // Stack the language lines in ONE bottom-anchored flex column: each line sits
  // on top of the previous with a fixed gap, so blocks can never overlap even
  // when a cue wraps to two lines (the old code anchored each language at a
  // fixed distance from the bottom and let it grow upward into the line above).
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: STACK_BOTTOM * scale,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: `${16 * scale}px`,
          padding: `0 ${40 * scale}px`,
          opacity: appear,
          transform: `scale(${popScale})`,
          transformOrigin: "center bottom",
        }}
      >
        {subtitleLanguages.map((lang) => {
          const style = LANG_STYLE[lang];
          const text = active[style.field] as string | undefined;
          if (!text) return null;
          return (
            <span
              key={lang}
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: MAX_LINES_PER_CUE,
                overflow: "hidden",
                maxWidth: "100%",
                textAlign: "center",
                fontFamily: style.fontFamily,
                fontSize: style.fontSize * scale,
                lineHeight: 1.25,
                color: style.color,
                fontWeight: 800,
                WebkitTextStroke: `${6 * scale}px black`,
                paintOrder: "stroke fill",
                textShadow: "3px 3px 6px rgba(0,0,0,0.9)",
                // Readability plate behind the text — keeps the large captions
                // legible over bright/busy footage.
                background: "rgba(0,0,0,0.42)",
                borderRadius: `${18 * scale}px`,
                padding: `${10 * scale}px ${26 * scale}px`,
              }}
            >
              {text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

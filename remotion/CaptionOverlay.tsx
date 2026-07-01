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
  { fontFamily: string; color: string; fontSize: number; bottom: number; field: keyof TimedSegment }
> = {
  // Large/bold, phone-first sizes (1080x1920 reference; scaled per ratio). The
  // stacked bottom margins keep Thai > English > Chinese clear of each other and
  // above the very bottom edge.
  th: { fontFamily: "'Sarabun', 'Noto Sans Thai', sans-serif", color: "#FFFFFF", fontSize: 76, bottom: 320, field: "textThai" },
  en: { fontFamily: "Arial, Helvetica, sans-serif", color: "#FFFFFF", fontSize: 68, bottom: 200, field: "textEnglish" },
  zh: { fontFamily: "'Microsoft YaHei', 'Noto Sans SC', sans-serif", color: "#FFFF00", fontSize: 62, bottom: 90, field: "textChinese" },
};

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

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {subtitleLanguages.map((lang) => {
        const style = LANG_STYLE[lang];
        const text = active[style.field] as string | undefined;
        if (!text) return null;
        return (
          <div
            key={lang}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: style.bottom * scale,
              textAlign: "center",
              padding: `0 ${40 * scale}px`,
              opacity: appear,
              transform: `scale(${popScale})`,
              transformOrigin: "center bottom",
            }}
          >
            <span
              style={{
                display: "inline-block",
                fontFamily: style.fontFamily,
                fontSize: style.fontSize * scale,
                lineHeight: 1.25,
                color: style.color,
                fontWeight: 800,
                WebkitTextStroke: `${6 * scale}px black`,
                paintOrder: "stroke fill",
                textShadow: "3px 3px 6px rgba(0,0,0,0.9)",
                // Readability plate behind the text — keeps the now-larger
                // captions legible over bright/busy footage.
                background: "rgba(0,0,0,0.42)",
                borderRadius: `${18 * scale}px`,
                padding: `${10 * scale}px ${26 * scale}px`,
              }}
            >
              {text}
            </span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

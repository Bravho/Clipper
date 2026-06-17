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
  th: { fontFamily: "'Sarabun', 'Noto Sans Thai', sans-serif", color: "#FFFFFF", fontSize: 52, bottom: 300, field: "textThai" },
  en: { fontFamily: "Arial, Helvetica, sans-serif", color: "#FFFFFF", fontSize: 48, bottom: 200, field: "textEnglish" },
  zh: { fontFamily: "'Microsoft YaHei', 'Noto Sans SC', sans-serif", color: "#FFFF00", fontSize: 42, bottom: 100, field: "textChinese" },
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
              fontFamily: style.fontFamily,
              fontSize: style.fontSize * scale,
              lineHeight: 1.25,
              color: style.color,
              fontWeight: 700,
              WebkitTextStroke: `${4 * scale}px black`,
              textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
              padding: `0 ${40 * scale}px`,
            }}
          >
            {text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

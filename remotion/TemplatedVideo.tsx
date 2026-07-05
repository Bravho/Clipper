import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DEFAULT_PALETTE, Palette, TemplatedVideoInputProps, TimedSegment } from "./types";

/**
 * Single-pass styled render. The merged master video plays underneath (audio
 * intact), the chosen template's frame/decor is drawn on top, and subtitles are
 * burned in — all in one opaque MP4, so there is NO alpha compositing.
 */
export function TemplatedVideo(props: TemplatedVideoInputProps) {
  const palette = props.palette ?? DEFAULT_PALETTE;
  const id = props.templateId;
  const inset = id === "framed_cream";
  const canvas = inset ? palette.neutral || "#FFF8F0" : "#000";

  return (
    <AbsoluteFill style={{ backgroundColor: canvas }}>
      {/* The client's real montage (voice + music baked in). Full-bleed by
          default; inset into a card for the framed template. */}
      {inset ? (
        <div
          style={{
            position: "absolute",
            top: "6.5%",
            left: "5.5%",
            right: "5.5%",
            bottom: "13%",
            borderRadius: 34,
            background: "#ffffff",
            padding: 22,
            boxShadow: "0 16px 42px rgba(0,0,0,0.22)",
          }}
        >
          <div style={{ width: "100%", height: "100%", borderRadius: 22, overflow: "hidden" }}>
            <OffthreadVideo src={props.masterUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      ) : (
        <OffthreadVideo src={props.masterUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}

      {/* Template decoration layer. */}
      {id === "clean_frame" && <CleanFrame palette={palette} />}
      {id === "framed_cream" && <FramedCreamDecor palette={palette} />}
      {id === "editorial" && <EditorialFrame palette={palette} />}

      {/* Subtitles (always on top). */}
      <Subtitles
        subtitleTimeline={props.subtitleTimeline}
        subtitleLanguages={props.subtitleLanguages}
      />
    </AbsoluteFill>
  );
}

/* ── Template: Clean Frame — white corner brackets + subtle ripple + accent ── */
function CleanFrame({ palette }: { palette: Palette }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const s = Math.min(width, height) / 1080; // short-side scale

  // Brackets ease in over the first 0.7s, then hold.
  const draw = interpolate(t, [0, 0.7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const brSize = 90 * s;
  const brInset = 44 * s;
  const brWidth = Math.max(3, 7 * s);
  const off = (1 - draw) * 20 * s;

  const bracket = (pos: "tl" | "tr" | "bl" | "br"): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: "absolute",
      width: brSize,
      height: brSize,
      border: `${brWidth}px solid #ffffff`,
      opacity: draw * 0.95,
      filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.55))",
      boxSizing: "border-box",
    };
    if (pos === "tl")
      return { ...base, top: brInset - off, left: brInset - off, borderRight: "none", borderBottom: "none", borderTopLeftRadius: 22 * s };
    if (pos === "tr")
      return { ...base, top: brInset - off, right: brInset - off, borderLeft: "none", borderBottom: "none", borderTopRightRadius: 22 * s };
    if (pos === "bl")
      return { ...base, bottom: brInset - off, left: brInset - off, borderRight: "none", borderTop: "none", borderBottomLeftRadius: 22 * s };
    return { ...base, bottom: brInset - off, right: brInset - off, borderLeft: "none", borderTop: "none", borderBottomRightRadius: 22 * s };
  };

  // Two staggered ripple rings pulsing from the BOTTOM-LEFT corner (a small
  // accent — kept compact so it doesn't sweep across the frame or the captions).
  const rippleX = width * 0.13;
  const rippleY = height * 0.84;
  const ripple = (delay: number): React.CSSProperties => {
    const period = 3.6;
    const p = ((t + delay) % period) / period;
    const size = interpolate(p, [0, 1], [0.15, 1]) * Math.min(width, height) * 0.32;
    const opacity = interpolate(p, [0, 0.15, 1], [0, 0.5, 0]);
    return {
      position: "absolute",
      left: rippleX,
      top: rippleY,
      width: size,
      height: size,
      marginLeft: -size / 2,
      marginTop: -size / 2,
      border: `${Math.max(2, 2.5 * s)}px solid ${palette.accent}`,
      borderRadius: "50%",
      opacity,
    };
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={bracket("tl")} />
      <div style={bracket("tr")} />
      <div style={bracket("bl")} />
      <div style={bracket("br")} />
      <div style={ripple(0)} />
      <div style={ripple(1.8)} />
      {/* Top accent bar in the brand accent color. */}
      <div
        style={{
          position: "absolute",
          top: 54 * s,
          left: "50%",
          width: 56 * s,
          height: 5 * s,
          marginLeft: -28 * s,
          borderRadius: 5 * s,
          background: palette.accent,
          opacity: draw * 0.9,
        }}
      />
    </AbsoluteFill>
  );
}

/** Concave 4-point sparkle path centered at (cx,cy) with radius r. */
function star4(cx: number, cy: number, r: number): string {
  const i = r * 0.24;
  return (
    `M${cx} ${cy - r} C${cx + i} ${cy - i} ${cx + i} ${cy - i} ${cx + r} ${cy} ` +
    `C${cx + i} ${cy + i} ${cx + i} ${cy + i} ${cx} ${cy + r} ` +
    `C${cx - i} ${cy + i} ${cx - i} ${cy + i} ${cx - r} ${cy} ` +
    `C${cx - i} ${cy - i} ${cx - i} ${cy - i} ${cx} ${cy - r} Z`
  );
}

/* ── Template: Framed Cream — video inset on a warm canvas + refined botanical line-art ── */
function FramedCreamDecor({ palette }: { palette: Palette }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const s = Math.min(width, height) / 1080;
  const draw = interpolate(t, [0.2, 1.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ink = palette.primary;
  const sw = Math.max(2.5, 3.2 * s);
  const dash = width * 2;

  // Long, low, elegant single wave across the bottom cream margin.
  const wy = height * 0.945;
  const seg = width * 0.11;
  const amp = 14 * s;
  let wave = `M ${width * 0.14} ${wy}`;
  for (let k = 0; k < 3; k++) {
    wave += ` q ${seg / 2} ${-amp} ${seg} 0 q ${seg / 2} ${amp} ${seg} 0`;
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }}>
        {/* botanical branch curving into the bottom-right margin */}
        <g
          transform={`translate(${width * 0.66}, ${height * 0.9}) scale(${s})`}
          fill="none"
          stroke={ink}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={dash}
          strokeDashoffset={dash * (1 - draw)}
          opacity={0.6}
        >
          <path d="M0 60 C 60 44 120 40 190 6" />
          <path d="M46 48 q 6 -22 -14 -30" />
          <path d="M84 40 q 8 -22 -12 -32" />
          <path d="M124 30 q 10 -22 -10 -34" />
          <path d="M162 16 q 10 -20 -8 -32" />
        </g>

        {/* the wave */}
        <path
          d={wave}
          fill="none"
          stroke={ink}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={dash}
          strokeDashoffset={dash * (1 - draw)}
          opacity={0.55}
        />

        {/* a few small dots for balance on the left */}
        <g fill={ink} opacity={0.5 * draw}>
          <circle cx={width * 0.12} cy={height * 0.9} r={4 * s} />
          <circle cx={width * 0.16} cy={height * 0.93} r={3 * s} />
          <circle cx={width * 0.1} cy={height * 0.955} r={3 * s} />
        </g>

        {/* a small sparkle accent top-left in the accent color */}
        <path d={star4(width * 0.1, height * 0.04, 16 * s)} fill={palette.accent} opacity={0.8 * draw} />
      </svg>
    </AbsoluteFill>
  );
}

/* ── Template: Editorial — hairline frame + cinematic scrims + a small kicker ── */
function EditorialFrame({ palette }: { palette: Palette }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const s = Math.min(width, height) / 1080;
  const draw = interpolate(t, [0.2, 1.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const inset = Math.round(Math.min(width, height) * 0.045);
  const bw = Math.max(2, 2.4 * s);
  const rectW = width - inset * 2;
  const rectH = height - inset * 2;
  const perim = 2 * (rectW + rectH);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Soft cinematic scrims — frame the image top/bottom and aid legibility. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "20%",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.42), rgba(0,0,0,0))",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "30%",
          background: "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0))",
        }}
      />
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }}>
        {/* Hairline frame, drawn on. */}
        <rect
          x={inset}
          y={inset}
          width={rectW}
          height={rectH}
          rx={18 * s}
          ry={18 * s}
          fill="none"
          stroke={palette.neutral}
          strokeWidth={bw}
          opacity={0.85 * draw}
          strokeDasharray={perim}
          strokeDashoffset={perim * (1 - draw)}
        />
        {/* Kicker: an accent dot + short rule, top-left inside the frame. */}
        <g opacity={draw}>
          <circle cx={inset + 34 * s} cy={inset + 42 * s} r={6 * s} fill={palette.accent} />
          <rect x={inset + 50 * s} y={inset + 39 * s} width={96 * s} height={5 * s} rx={2.5 * s} fill={palette.accent} />
        </g>
      </svg>
    </AbsoluteFill>
  );
}

/* ── Subtitles — large, short-side scaled so 16:9 and 9:16 match ── */
const LANG_STYLE: Record<
  "th" | "en" | "zh",
  { fontFamily: string; color: string; fontSize: number; maxChars: number; field: keyof TimedSegment }
> = {
  th: { fontFamily: "'Sarabun', 'Noto Sans Thai', sans-serif", color: "#FFFFFF", fontSize: 62, maxChars: 26, field: "textThai" },
  en: { fontFamily: "Arial, Helvetica, sans-serif", color: "#FFFFFF", fontSize: 52, maxChars: 30, field: "textEnglish" },
  zh: { fontFamily: "'Microsoft YaHei', 'Noto Sans SC', sans-serif", color: "#FFE066", fontSize: 50, maxChars: 16, field: "textChinese" },
};

/** Distance of the whole caption stack from the bottom edge (1080-short-side ref). */
const STACK_BOTTOM = 150;

type SegmenterLike = { segment: (s: string) => Iterable<{ segment: string }> };
const SegmenterCtor = (
  Intl as unknown as {
    Segmenter?: new (locale: string, opts: { granularity: "word" }) => SegmenterLike;
  }
).Segmenter;

/**
 * Word-segment a no-space script (Thai/Chinese) via the built-in
 * `Intl.Segmenter` (ICU) so line breaks fall on real word boundaries instead of
 * mid-word. Falls back to per-character when ICU word data is unavailable.
 */
function segmentNoSpaceWords(text: string): string[] {
  if (SegmenterCtor) {
    try {
      const isThai = /[฀-๿]/.test(text);
      const seg = new SegmenterCtor(isThai ? "th" : "zh", { granularity: "word" });
      const units = Array.from(seg.segment(text), (s) => s.segment).filter((u) => u.length > 0);
      if (units.length > 0) return units;
    } catch {
      /* fall through to char split */
    }
  }
  return Array.from(text);
}

/** Split `units` into two lines balanced by character length (no mid-unit cut). */
function balanceTwoLines(units: string[], joiner: string): string[] {
  if (units.length < 2) return [units.join(joiner)];
  const total = units.reduce((n, u) => n + u.length, 0) + joiner.length * (units.length - 1);
  const target = Math.ceil(total / 2);
  let acc = 0;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 0; i < units.length - 1; i++) {
    acc += units[i].length + joiner.length;
    const diff = Math.abs(acc - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i + 1;
    }
  }
  return [units.slice(0, best).join(joiner), units.slice(best).join(joiner)];
}

/**
 * Split an over-long caption into up to two balanced lines so it reads as short,
 * tidy clauses instead of one very wide line. Breaks on WORD boundaries for both
 * space-separated text (English) and continuous scripts (Thai/Chinese, via
 * `Intl.Segmenter`) — never mid-word.
 */
function wrapCaption(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return [trimmed];

  if (/\s/.test(trimmed)) {
    return balanceTwoLines(trimmed.split(/\s+/).filter(Boolean), " ");
  }

  return balanceTwoLines(segmentNoSpaceWords(trimmed), "");
}

function Subtitles({
  subtitleTimeline,
  subtitleLanguages,
}: Pick<TemplatedVideoInputProps, "subtitleTimeline" | "subtitleLanguages">) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const scale = Math.min(width, height) / 1080;

  const active = subtitleTimeline.find((seg) => t >= seg.startSecond && t <= seg.endSecond);
  if (!active) return null;

  const appear = Math.min(1, Math.max(0, (t - active.startSecond) / 0.15));

  // Stack the language lines in ONE bottom-anchored flex column so each line
  // sits above the previous with a fixed gap — they can never overlap even when
  // a cue wraps to two lines (the old code pinned each language at a fixed
  // distance from the bottom and let it grow upward into the line above).
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
          padding: `0 ${48 * scale}px`,
          opacity: appear,
          transform: `scale(${0.96 + 0.04 * appear})`,
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
                display: "inline-block",
                maxWidth: "100%",
                textAlign: "center",
                fontFamily: style.fontFamily,
                fontSize: style.fontSize * scale,
                lineHeight: 1.22,
                color: style.color,
                fontWeight: 800,
                WebkitTextStroke: `${6 * scale}px black`,
                paintOrder: "stroke fill",
                textShadow: "3px 3px 6px rgba(0,0,0,0.9)",
                background: "rgba(0,0,0,0.4)",
                borderRadius: `${18 * scale}px`,
                padding: `${10 * scale}px ${26 * scale}px`,
              }}
            >
              {wrapCaption(text, style.maxChars).map((line, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <br />}
                  {line}
                </React.Fragment>
              ))}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

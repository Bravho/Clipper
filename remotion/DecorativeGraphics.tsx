import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Palette, ScenePlanEntry } from "./types";

/**
 * Lively decorative motion-graphics layer (transparent): drifting brand-color
 * blobs, gently animated bottom waves, floating triangles/confetti, and sparkle
 * pops at scene cuts. Everything is deterministic (frame-driven) and weighted to
 * the EDGES and CORNERS so the food in the center stays clear. Colors come from
 * the brand/content palette.
 */
export function DecorativeGraphics({
  palette,
  scenePlan,
}: {
  palette: Palette;
  scenePlan: ScenePlanEntry[];
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  // Cumulative scene-boundary times (seconds) for sparkle pops.
  const boundaries: number[] = [];
  let acc = 0;
  for (const s of scenePlan) {
    acc += s.durationSeconds || 0;
    boundaries.push(acc);
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <Blobs palette={palette} t={t} width={width} height={height} />
      <Waves palette={palette} t={t} width={width} height={height} />
      <Triangles palette={palette} t={t} width={width} height={height} />
      <Sparkles palette={palette} t={t} width={width} height={height} boundaries={boundaries} />
      <CornerArc palette={palette} t={t} width={width} height={height} />
    </AbsoluteFill>
  );
}

/** Soft drifting brand-color blobs in the corners (depth / liveliness). */
function Blobs({ palette, t, width, height }: ShapeProps) {
  const blobs = [
    { x: 0.08, y: 0.12, r: 0.26, color: palette.primary, speed: 0.5, phase: 0 },
    { x: 0.92, y: 0.2, r: 0.22, color: palette.secondary, speed: 0.4, phase: 2 },
    { x: 0.85, y: 0.86, r: 0.24, color: palette.accent, speed: 0.45, phase: 4 },
  ];
  return (
    <>
      {blobs.map((b, i) => {
        const dx = Math.sin(t * b.speed + b.phase) * 0.03 * width;
        const dy = Math.cos(t * b.speed * 0.8 + b.phase) * 0.03 * height;
        const r = b.r * Math.min(width, height);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: b.x * width - r + dx,
              top: b.y * height - r + dy,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${b.color}55 0%, ${b.color}22 45%, transparent 70%)`,
              filter: "blur(2px)",
            }}
          />
        );
      })}
    </>
  );
}

/** Two layered waves gently sliding along the bottom edge. */
function Waves({ palette, t, width, height }: ShapeProps) {
  const waveH = height * 0.16;
  const layers = [
    { color: palette.primary, opacity: 0.5, speed: 26, amp: 14, y: height - waveH * 0.55 },
    { color: palette.accent, opacity: 0.42, speed: -34, amp: 20, y: height - waveH * 0.3 },
  ];
  return (
    <>
      {layers.map((l, i) => {
        const shift = (t * l.speed) % width;
        return (
          <svg
            key={i}
            width={width}
            height={waveH}
            viewBox={`0 0 ${width} ${waveH}`}
            style={{ position: "absolute", left: 0, top: l.y, opacity: l.opacity }}
            preserveAspectRatio="none"
          >
            <path
              d={wavePath(width, waveH, l.amp, shift)}
              fill={l.color}
            />
          </svg>
        );
      })}
    </>
  );
}

function wavePath(w: number, h: number, amp: number, shift: number): string {
  const seg = w / 4;
  const mid = h * 0.45;
  let d = `M ${-shift} ${mid}`;
  for (let x = -shift; x <= w + seg; x += seg) {
    d += ` q ${seg / 2} ${-amp} ${seg} 0 q ${seg / 2} ${amp} ${seg} 0`;
  }
  d += ` L ${w} ${h} L 0 ${h} Z`;
  return d;
}

/** Floating triangles + dots drifting up the left/right edges (center kept clear). */
function Triangles({ palette, t, width, height }: ShapeProps) {
  const colors = [palette.primary, palette.secondary, palette.accent, palette.neutral];
  const items = Array.from({ length: 14 }, (_, i) => {
    const seed = i * 9301 + 49297;
    const rnd = (n: number) => ((Math.sin(seed * (n + 1)) + 1) / 2);
    const leftSide = i % 2 === 0;
    const xBand = leftSide ? 0.02 + rnd(1) * 0.14 : 0.84 + rnd(2) * 0.14;
    const size = (10 + rnd(3) * 26);
    const speed = 0.04 + rnd(4) * 0.06;
    const startY = rnd(5);
    const isTri = i % 3 !== 0;
    const color = colors[i % colors.length];
    return { xBand, size, speed, startY, isTri, color, spin: rnd(6) * 2 - 1, phase: rnd(7) * 6 };
  });

  return (
    <>
      {items.map((it, i) => {
        const prog = (it.startY + t * it.speed) % 1.2;
        const y = (1.1 - prog) * height;
        const x = it.xBand * width + Math.sin(t * 0.6 + it.phase) * 10;
        const rot = (t * it.spin * 40 + it.phase * 60) % 360;
        const opacity = interpolate(prog, [0, 0.1, 1.0, 1.2], [0, 0.85, 0.85, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        if (it.isTri) {
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: 0,
                height: 0,
                opacity,
                transform: `rotate(${rot}deg)`,
                borderLeft: `${it.size / 2}px solid transparent`,
                borderRight: `${it.size / 2}px solid transparent`,
                borderBottom: `${it.size}px solid ${it.color}`,
              }}
            />
          );
        }
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: it.size * 0.5,
              height: it.size * 0.5,
              opacity,
              borderRadius: "50%",
              background: it.color,
            }}
          />
        );
      })}
    </>
  );
}

/** Sparkle / star pops at each scene boundary, in alternating corners. */
function Sparkles({ palette, t, width, height, boundaries }: ShapeProps & { boundaries: number[] }) {
  const POP = 0.5; // seconds
  return (
    <>
      {boundaries.map((b, i) => {
        const dt = t - (b - 0.15);
        if (dt < 0 || dt > POP) return null;
        const p = dt / POP;
        const scale = interpolate(p, [0, 0.3, 1], [0, 1.2, 0.6]);
        const opacity = interpolate(p, [0, 0.3, 1], [0, 1, 0]);
        const corner = [
          { x: 0.14, y: 0.16 },
          { x: 0.86, y: 0.18 },
          { x: 0.16, y: 0.8 },
          { x: 0.84, y: 0.82 },
        ][i % 4];
        const s = Math.min(width, height) * 0.07;
        return (
          <svg
            key={i}
            width={s}
            height={s}
            viewBox="0 0 100 100"
            style={{
              position: "absolute",
              left: corner.x * width - s / 2,
              top: corner.y * height - s / 2,
              opacity,
              transform: `scale(${scale}) rotate(${p * 90}deg)`,
            }}
          >
            <path
              d="M50 0 L60 40 L100 50 L60 60 L50 100 L40 60 L0 50 L40 40 Z"
              fill={palette.neutral}
            />
          </svg>
        );
      })}
    </>
  );
}

/** A drawn-on accent arc in a top corner for a designed, branded feel. */
function CornerArc({ palette, t, width, height }: ShapeProps) {
  const s = Math.min(width, height) * 0.3;
  const dash = 2 * Math.PI * (s * 0.4);
  const draw = interpolate(t, [0.2, 1.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      style={{ position: "absolute", left: -s * 0.35, top: -s * 0.35 }}
    >
      <circle
        cx={s / 2}
        cy={s / 2}
        r={s * 0.4}
        fill="none"
        stroke={palette.accent}
        strokeWidth={Math.max(4, s * 0.02)}
        strokeLinecap="round"
        strokeDasharray={dash}
        strokeDashoffset={dash * (1 - draw)}
        opacity={0.85}
      />
    </svg>
  );
}

interface ShapeProps {
  palette: Palette;
  t: number;
  width: number;
  height: number;
}

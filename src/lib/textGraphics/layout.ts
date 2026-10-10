/**
 * Text-graphics LAYOUT — THE REFERENCE for every renderer.
 *
 * Turns one plan item into a small tree of boxes in frame pixels. The Android
 * painter and the iOS layer builder implement the same rules with their own
 * text measurement (same font files, so the same advances). All lengths below
 * are reference px at a 1080 short side, multiplied by `s`.
 *
 * HOW. Every item is first laid out with its top-left at (margin, safe top),
 * then the whole tree is shifted so its bounding box lands on its POSITION
 * (the plan's, else the pack's default for the kind). Captions sit at the
 * bottom of the frame, so positions are the top band or mid-height on a side.
 * On a tall frame (h/w ≥ 1.5) the top 11% is left clear for the
 * TikTok/Reels/Shorts top bar.
 *
 * FRAMES. A hook or label panel is drawn as its pack's frame (card, none,
 * post-it, painting, ribbon, bubble); the frame adds its own padding so the
 * words always sit inside it.
 */
import {
  isTextGraphicPosition,
  type TextGraphicAnim,
  type TextGraphicFrame,
  type TextGraphicIdle,
  type TextGraphicPosition,
  type TextGraphicStyleSpec,
  type TextGraphicTextEffect,
} from "@/config/textGraphicStyles";
import type { TextGraphicItem } from "./plan";

export type Measure = (text: string, fontKey: string, sizePx: number) => number;

export interface FontMetrics {
  ascent: number;
  descent: number;
}

/** A text effect, resolved to pixels and a colour. */
export interface TgTextEffect {
  kind: TextGraphicTextEffect;
  color: string;
  /** shadow/glow: blur in px (canvas `shadowBlur`). */
  blur: number;
  /** shadow: vertical offset in px. */
  dy: number;
  /** outline: stroke width in px. */
  width: number;
}

export type TgPaint =
  | { type: "none" }
  | { type: "box"; color: string; radius: number; shadowDx: number; shadowDy: number; shadow: string }
  | {
      type: "panel";
      frame: TextGraphicFrame;
      color: string;
      radius: number;
      shadowDx: number;
      shadowDy: number;
      shadow: string;
      frameColor: string;
      frameInner: string;
      frameAccent: string;
      frameMat: string;
      tape: string;
      /** Painting: moulding width. Ribbon: notch depth. Px. */
      frameWidth: number;
      /** The frame scale, for the fixed-size details (tape, tail, lines). */
      s: number;
    }
  | {
      type: "text";
      text: string;
      font: string;
      size: number;
      color: string;
      ascent: number;
      effect: TgTextEffect;
    }
  | { type: "dot"; color: string }
  | { type: "pin"; color: string }
  | {
      type: "badge";
      shape: "circle" | "burst" | "tag";
      bg: string;
      ring: string;
      text: string;
      font: string;
      size: number;
      color: string;
      ascent: number;
      descent: number;
    };

export interface TgNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Scale/rotation origin. */
  anchor: "left" | "center" | "top";
  anim: TextGraphicAnim | null;
  idle?: TextGraphicIdle;
  /** Static rotation in degrees about the centre (badges). */
  rotate: number;
  paint: TgPaint;
  children: TgNode[];
}

export interface TgItemLayout {
  item: TextGraphicItem;
  /** The item's bounding box after placement. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tilt and exit-scale pivot: the box corner on its own side, or its centre. */
  pivotX: number;
  pivotY: number;
  position: TextGraphicPosition;
  nodes: TgNode[];
}

/** The short-side scale, as captions use it. */
export function frameScale(width: number, height: number): number {
  return Math.min(width, height) / 1080;
}

export function safeTop(width: number, height: number): number {
  const s = frameScale(width, height);
  return height / width >= 1.5 ? 0.11 * height : Math.max(56 * s, 0.06 * height);
}

export const MARGIN_X = 64;

/** Resolve `"accent"` to the request's accent colour. */
export function resolveColor(value: string, accent: string): string {
  return value === "accent" ? accent : value;
}

function node(partial: Partial<TgNode> & Pick<TgNode, "id" | "x" | "y" | "w" | "h">): TgNode {
  return { anchor: "left", anim: null, rotate: 0, paint: { type: "none" }, children: [], ...partial };
}

function lineHeight(size: number, m: FontMetrics): number {
  return size * (m.ascent + m.descent);
}

const PLAIN: TgTextEffect = { kind: "plain", color: "#00000000", blur: 0, dy: 0, width: 0 };

/** The pack's text effect at a given font size. */
export function textEffectFor(style: TextGraphicStyleSpec, accent: string, size: number, s: number): TgTextEffect {
  const color = resolveColor(style.colors.textEffect, accent);
  switch (style.shape.textEffect) {
    case "shadow":
      return { kind: "shadow", color, blur: 12 * s, dy: 3 * s, width: 0 };
    case "outline":
      return { kind: "outline", color, blur: 0, dy: 0, width: Math.max(3 * s, size * 0.12) };
    case "glow":
      return { kind: "glow", color, blur: size * 0.45, dy: 0, width: 0 };
    case "marker":
      // A highlighter stroke behind big words; small words get a soft shadow instead.
      return size >= 40 * s
        ? { kind: "marker", color, blur: 8 * s, dy: 2 * s, width: 10 * s }
        : { kind: "shadow", color: "#000000B0", blur: 8 * s, dy: 2 * s, width: 0 };
    default:
      return PLAIN;
  }
}

/** Extra padding a frame needs around the words: [left, right, top, bottom], px. */
export function framePadding(style: TextGraphicStyleSpec, s: number): [number, number, number, number] {
  const fw = style.shape.frameWidth * s;
  switch (style.shape.frame) {
    case "painting":
      // Moulding plus the 12-px mat.
      return [fw + 12 * s, fw + 12 * s, fw + 12 * s, fw + 12 * s];
    case "ribbon":
    case "slant":
      return [fw, fw, 0, 0];
    case "postit":
      return [6 * s, 6 * s, 18 * s, 6 * s];
    default:
      return [0, 0, 0, 0];
  }
}

export function layoutTextGraphicItem(input: {
  item: TextGraphicItem;
  style: TextGraphicStyleSpec;
  accent: string;
  width: number;
  height: number;
  measure: Measure;
  metrics: (fontKey: string) => FontMetrics;
}): TgItemLayout {
  const { item, style, width, height } = input;
  const nodes =
    item.kind === "hook" ? layoutHook(input) : item.kind === "cta" ? layoutCta(input) : layoutLabel(input);
  const fallback = style.positions[item.kind] ?? "top-left";
  const position: TextGraphicPosition = isTextGraphicPosition(item.position) ? item.position : fallback;
  // A hung painting's wire and nail rise 44 px above the frame: keep them on screen.
  const wireTop = style.shape.frame === "painting" && item.kind !== "cta" ? 50 * frameScale(width, height) : 0;
  return place(item, nodes, position, width, height, wireTop);
}

type LayoutInput = Parameters<typeof layoutTextGraphicItem>[0];

/** The bounding box of the top-level nodes. */
function bounds(nodes: TgNode[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function shift(n: TgNode, dx: number, dy: number) {
  n.x += dx;
  n.y += dy;
  for (const child of n.children) shift(child, dx, dy);
}

/** Move the laid-out tree so its bounding box sits at `position`. */
function place(
  item: TextGraphicItem,
  nodes: TgNode[],
  position: TextGraphicPosition,
  width: number,
  height: number,
  extraTop = 0
): TgItemLayout {
  const s = frameScale(width, height);
  const M = MARGIN_X * s;
  const top = safeTop(width, height) + extraTop;
  const box = bounds(nodes);
  const [row, col] = position.split("-") as ["top" | "middle", "left" | "center" | "right"];
  const x = col === "left" ? M : col === "right" ? width - M - box.w : (width - box.w) / 2;
  const y = row === "top" ? top : Math.max(top, 0.42 * height - box.h / 2);
  for (const n of nodes) shift(n, x - box.x, y - box.y);
  const centred = col === "center" || item.kind === "cta";
  return {
    item,
    x,
    y,
    w: box.w,
    h: box.h,
    pivotX: centred ? x + box.w / 2 : col === "right" ? x + box.w : x,
    pivotY: centred ? y + box.h / 2 : y,
    position,
    nodes,
  };
}

function textNode(
  id: string,
  text: string,
  font: string,
  size: number,
  color: string,
  x: number,
  y: number,
  measure: Measure,
  m: FontMetrics,
  anim: TextGraphicAnim | null,
  effect: TgTextEffect = PLAIN
): TgNode {
  return node({
    id,
    x,
    y,
    w: measure(text, font, size),
    h: lineHeight(size, m),
    anim,
    paint: { type: "text", text, font, size, color, ascent: m.ascent, effect },
  });
}

/** Shrink a font size so `text` fits `maxWidth`, down to `minFactor`. */
function fitSize(
  text: string,
  font: string,
  size: number,
  maxWidth: number,
  measure: Measure,
  minFactor = 0.6
): number {
  const w = measure(text, font, size);
  if (w <= maxWidth || w <= 0) return size;
  return Math.max(size * minFactor, (size * maxWidth) / w);
}

function panelPaint(
  style: TextGraphicStyleSpec,
  accent: string,
  s: number,
  color: string,
  radius: number
): TgPaint {
  const c = (v: string) => resolveColor(v, accent);
  return {
    type: "panel",
    frame: style.shape.frame,
    color: c(color),
    radius,
    shadowDx: style.shape.shadowDx * s,
    shadowDy: style.shape.shadowDy * s,
    shadow: c(style.colors.shadow),
    frameColor: c(style.colors.frame),
    frameInner: c(style.colors.frameInner),
    frameAccent: c(style.colors.frameAccent),
    frameMat: c(style.colors.frameMat),
    tape: c(style.colors.tape),
    frameWidth: style.shape.frameWidth * s,
    s,
  };
}

/** Card padding around the words; a frameless panel has none. */
function basePadding(style: TextGraphicStyleSpec, s: number, l: number, r: number, t: number, b: number) {
  if (style.shape.frame === "none") return [0, 0, 0, 0];
  const [fl, fr, ft, fb] = framePadding(style, s);
  return [l * s + fl, r * s + fr, t * s + ft, b * s + fb];
}

function layoutLabel({ item, style, accent, width, height, measure, metrics }: LayoutInput): TgNode[] {
  const s = frameScale(width, height);
  const c = (v: string) => resolveColor(v, accent);
  const M = MARGIN_X * s;
  const top = safeTop(width, height);
  const hasBadge = Boolean(item.badge);
  const D = style.sizes.badgeDiameter * s;
  const barW = style.shape.barWidth * s;
  const barGap = barW > 0 ? 14 * s : 0;
  const [padL, padR, padT, padB] = basePadding(style, s, 26, 30, 16, 20);

  const maxText = width - 2 * M - barW - barGap - padL - padR - (hasBadge ? 0.9 * D : 0);
  const titleFont = style.fonts.title;
  const bodyFont = style.fonts.body;
  const titleSize = fitSize(item.title, titleFont, style.sizes.title * s, maxText, measure);
  const sub = style.shape.uppercaseSub ? item.sub.toUpperCase() : item.sub;
  const subSize = fitSize(sub, bodyFont, style.sizes.sub * s, maxText, measure);
  const numSize = style.sizes.num * s;
  const mt = metrics(titleFont);
  const mb = metrics(bodyFont);

  const cardX = M + barW + barGap;
  const innerX = cardX + padL;
  let y = top + padT;
  const children: TgNode[] = [];

  if (item.num) {
    const n = textNode("num", item.num, titleFont, numSize, c(style.colors.num), innerX, y, measure, mt,
      style.motion.num, textEffectFor(style, accent, numSize, s));
    children.push(n);
    y += n.h + 2 * s;
  }
  const title = textNode("title", item.title, titleFont, titleSize, c(style.colors.title), innerX, y, measure, mt,
    style.motion.title, textEffectFor(style, accent, titleSize, s));
  children.push(title);
  y += title.h;
  if (style.shape.underline) {
    y += 4 * s;
    children.push(
      node({
        id: "underline",
        x: innerX,
        y,
        w: title.w,
        h: 6 * s,
        anim: style.motion.underline,
        paint: { type: "box", color: c(style.colors.underline), radius: 3 * s, shadowDx: 0, shadowDy: 0, shadow: "#00000000" },
      })
    );
    y += 6 * s + 8 * s;
  } else {
    y += 4 * s;
  }
  if (sub) {
    const subNode = textNode("sub", sub, bodyFont, subSize, c(style.colors.sub), innerX, y, measure, mb,
      style.motion.sub, textEffectFor(style, accent, subSize, s));
    children.push(subNode);
    y += subNode.h;
  }
  const contentW = Math.max(...children.map((ch) => ch.w), 0);
  const cardW = padL + contentW + padR;
  const cardH = y + padB - top;

  const nodes: TgNode[] = [];
  if (barW > 0) {
    nodes.push(
      node({
        id: "bar",
        x: M,
        y: top,
        w: barW,
        h: cardH,
        anchor: "top",
        anim: style.motion.bar,
        paint: { type: "box", color: c(style.colors.bar), radius: barW / 2, shadowDx: 0, shadowDy: 0, shadow: "#00000000" },
      })
    );
  }
  nodes.push(
    node({
      id: "card",
      x: cardX,
      y: top,
      w: cardW,
      h: cardH,
      anim: style.motion.card,
      paint: panelPaint(style, accent, s, style.colors.cardBg, style.shape.cardRadius * s),
      children,
    })
  );
  if (hasBadge) {
    const mBadge = metrics(style.fonts.badge);
    const bw = style.shape.badge === "tag" ? 1.4 * D : D;
    const bh = style.shape.badge === "tag" ? 0.6 * D : D;
    // The badge overlaps the panel's top-right corner by a tenth of its
    // height; with no panel it keeps clear of the words instead.
    const overlap = style.shape.frame === "none" ? -16 * s : 0.1 * bh;
    const cx = cardX + cardW + bw / 2 - overlap;
    const cy = top + 0.22 * D;
    const textMax = (style.shape.badge === "tag" ? 1.15 : 0.66) * D;
    const size = fitSize(item.badge, style.fonts.badge, style.sizes.badgeText * s, textMax, measure, 0.5);
    nodes.push(
      node({
        id: "badge",
        x: cx - bw / 2,
        y: cy - bh / 2,
        w: bw,
        h: bh,
        anchor: "center",
        anim: style.motion.badge,
        idle: style.motion.badgeIdle,
        rotate: style.shape.badgeRotate,
        paint: {
          type: "badge",
          shape: style.shape.badge,
          bg: c(style.colors.badgeBg),
          ring: c(style.colors.badgeRing),
          text: item.badge,
          font: style.fonts.badge,
          size,
          color: c(style.colors.badgeText),
          ascent: mBadge.ascent,
          descent: mBadge.descent,
        },
      })
    );
  }
  return nodes;
}

function layoutHook({ item, style, accent, width, height, measure, metrics }: LayoutInput): TgNode[] {
  const s = frameScale(width, height);
  const c = (v: string) => resolveColor(v, accent);
  const M = MARGIN_X * s;
  const top = safeTop(width, height);
  const [padL, padR, padT, padB] = basePadding(style, s, 22, 30, 16, 20);
  const dotD = style.shape.hookDot ? 44 * s : 0;
  const dotGap = style.shape.hookDot ? 18 * s : 0;
  const font = style.fonts.hook;
  const bodyFont = style.fonts.body;
  const mh = metrics(font);
  const mb = metrics(bodyFont);
  const maxText = width - 2 * M - padL - padR;

  const innerX = M + padL;
  let y = top + padT;
  const children: TgNode[] = [];

  if (item.kicker) {
    const kickerText = item.kicker.toUpperCase();
    const size = fitSize(kickerText, bodyFont, style.sizes.kicker * s, maxText - 28 * s, measure);
    const label = textNode("kickerText", kickerText, bodyFont, size, c(style.colors.kickerText), innerX + 14 * s, y + 6 * s, measure, mb, null);
    const chip = node({
      id: "kicker",
      x: innerX,
      y,
      w: label.w + 28 * s,
      h: label.h + 12 * s,
      anim: style.motion.kicker,
      paint: { type: "box", color: c(style.colors.kickerBg), radius: 6 * s, shadowDx: 0, shadowDy: 0, shadow: "#00000000" },
      children: [label],
    });
    children.push(chip);
    y += chip.h + 10 * s;
  }

  const titleSize = fitSize(item.title, font, style.sizes.hookTitle * s, maxText - dotD - dotGap, measure);
  const titleH = lineHeight(titleSize, mh);
  const rowH = Math.max(dotD, titleH);
  if (dotD > 0) {
    children.push(
      node({
        id: "dot",
        x: innerX,
        y: y + (rowH - dotD) / 2,
        w: dotD,
        h: dotD,
        anchor: "center",
        anim: style.motion.dot,
        paint: { type: "dot", color: c(style.colors.dot) },
      })
    );
  }
  children.push(
    textNode("hookTitle", item.title, font, titleSize, c(style.colors.hookTitle), innerX + dotD + dotGap,
      y + (rowH - titleH) / 2, measure, mh, style.motion.hookTitle, textEffectFor(style, accent, titleSize, s))
  );
  y += rowH + 4 * s;

  if (item.sub) {
    const size = fitSize(item.sub, bodyFont, style.sizes.hookSub * s, maxText, measure);
    const sub = textNode("hookSub", item.sub, bodyFont, size, c(style.colors.hookSub), innerX, y, measure, mb,
      style.motion.hookSub, textEffectFor(style, accent, size, s));
    children.push(sub);
    y += sub.h;
  }

  const contentRight = Math.max(...children.map((ch) => ch.x + ch.w));
  const boxW = contentRight - M + padR;
  const boxH = y + padB - top;
  return [
    node({
      id: "hookBox",
      x: M,
      y: top,
      w: boxW,
      h: boxH,
      anim: style.motion.hookBox,
      paint: panelPaint(style, accent, s, style.colors.hookBg, style.shape.cardRadius * s),
      children,
    }),
  ];
}

function layoutCta(input: LayoutInput): TgNode[] {
  const first = layoutCtaAt(input, 1);
  const s = frameScale(input.width, input.height);
  const maxW = input.width - 2 * MARGIN_X * s;
  if (first[0].w <= maxW) return first;
  return layoutCtaAt(input, Math.max(0.55, maxW / first[0].w));
}

function layoutCtaAt({ item, style, accent, width, height, measure, metrics }: LayoutInput, f: number): TgNode[] {
  const s = frameScale(width, height) * f;
  const c = (v: string) => resolveColor(v, accent);
  const top = safeTop(width, height);
  const padX = 22 * s;
  const padY = 18 * s;
  const pinSize = 72 * s;
  const gap1 = 20 * s;
  const gap2 = 26 * s;
  const titleFont = style.fonts.title;
  const bodyFont = style.fonts.body;
  const mt = metrics(titleFont);
  const mb = metrics(bodyFont);

  const brandSize = style.sizes.ctaBrand * s;
  const placeSize = style.sizes.ctaPlace * s;
  const buttonSize = style.sizes.ctaButton * s;
  const brandW = item.brand ? measure(item.brand, titleFont, brandSize) : 0;
  const placeW = item.place ? measure(item.place, bodyFont, placeSize) : 0;
  const brandH = item.brand ? lineHeight(brandSize, mt) : 0;
  const placeH = item.place ? lineHeight(placeSize, mb) : 0;
  const colW = Math.max(brandW, placeW);
  const colH = brandH + placeH;
  const buttonTextW = item.title ? measure(item.title, titleFont, buttonSize) : 0;
  const buttonH = item.title ? lineHeight(buttonSize, mt) + 24 * s : 0;
  const buttonW = item.title ? buttonTextW + 60 * s : 0;

  const innerH = Math.max(pinSize, colH, buttonH);
  const contentW = pinSize + (colW > 0 ? gap1 + colW : 0) + (buttonW > 0 ? gap2 + buttonW : 0);
  const cardW = padX * 2 + contentW;
  const cardH = padY * 2 + innerH;
  const cardX = MARGIN_X * frameScale(width, height);
  const cardY = top;
  const midY = cardY + padY + innerH / 2;

  const children: TgNode[] = [];
  let x = cardX + padX;
  children.push(
    node({
      id: "pin",
      x,
      y: midY - pinSize / 2,
      w: pinSize,
      h: pinSize,
      anchor: "center",
      anim: style.motion.pin,
      paint: { type: "pin", color: c(style.colors.pin) },
    })
  );
  x += pinSize;
  if (colW > 0) {
    x += gap1;
    let y = midY - colH / 2;
    if (item.brand) {
      children.push(textNode("brand", item.brand, titleFont, brandSize, c(style.colors.ctaBrand), x, y, measure, mt, style.motion.ctaText));
      y += brandH;
    }
    if (item.place) {
      children.push(textNode("place", item.place, bodyFont, placeSize, c(style.colors.ctaPlace), x, y, measure, mb, style.motion.ctaText));
    }
    x += colW;
  }
  if (buttonW > 0) {
    x += gap2;
    const label = textNode("buttonText", item.title, titleFont, buttonSize, c(style.colors.buttonText), x + 30 * s, midY - buttonH / 2 + 12 * s, measure, mt, null);
    children.push(
      node({
        id: "button",
        x,
        y: midY - buttonH / 2,
        w: buttonW,
        h: buttonH,
        anchor: "center",
        anim: style.motion.button,
        idle: style.motion.buttonIdle,
        paint: { type: "box", color: c(style.colors.buttonBg), radius: buttonH / 2, shadowDx: 0, shadowDy: 0, shadow: "#00000000" },
        children: [label],
      })
    );
  }

  return [
    node({
      id: "ctaCard",
      x: cardX,
      y: cardY,
      w: cardW,
      h: cardH,
      anchor: "center",
      anim: style.motion.ctaCard,
      paint: {
        type: "box",
        color: c(style.colors.ctaBg),
        radius: style.shape.ctaRadius * s,
        shadowDx: style.shape.shadowDx * s,
        shadowDy: style.shape.shadowDy * s,
        shadow: c(style.colors.shadow),
      },
      children,
    }),
  ];
}

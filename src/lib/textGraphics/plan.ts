/**
 * The per-request text-graphics PLAN: which words show, when, and in which
 * style pack. Pure and dependency-light so it runs on the server, in the
 * studio, and in tests.
 *
 * Times are in VIDEO (picture) seconds — the timeline the phone exports, which
 * starts with the music lead-in before the voice. The labels belong to scenes,
 * and scenes are placed on the picture timeline, so unlike the captions (voice
 * time, shifted by the builder) the plan is NOT shifted again.
 */
import {
  DEFAULT_TEXT_GRAPHIC_CHOICE,
  TEXT_GRAPHIC_FONTS,
  fontsForStyle,
  getTextGraphicStyle,
  isTextGraphicChoice,
  isTextGraphicPosition,
  isTextGraphicStyleId,
  textGraphicFontPath,
  type TextGraphicChoice,
  type TextGraphicStyleId,
  type TextGraphicStyleSpec,
} from "@/config/textGraphicStyles";

export type TextGraphicKind = "hook" | "label" | "cta";

export interface TextGraphicItem {
  kind: TextGraphicKind;
  start: number;
  end: number;
  /** Main line (Thai). Hook: the business/attention line. CTA: the button text. */
  title: string;
  /** Second line (English). CTA: unused. */
  sub: string;
  /** Hook only: small chip above the title, e.g. "JAPANESE RESTAURANT". */
  kicker: string;
  /** Label only: a small chapter number, e.g. "01". */
  num: string;
  /** Label only: a stamp next to the card, e.g. "แนะนำ!". */
  badge: string;
  /** CTA only: the brand name (first line). */
  brand: string;
  /** CTA only: where (second line). */
  place: string;
  /**
   * Where it sits (`TEXT_GRAPHIC_POSITIONS`), or "" for the style pack's
   * default for its kind. Claude sets it to move a label off the subject.
   */
  position: string;
}

export interface TextGraphicsPlan {
  version: 1;
  /** What the requester picked. */
  choice: TextGraphicChoice;
  /** The pack actually used (Claude's pick when the choice was "auto"). */
  styleId: TextGraphicStyleId;
  items: TextGraphicItem[];
  source: "claude" | "fallback";
  /** Inputs the plan was written from; a different fingerprint means "write it again". */
  fingerprint: string;
  durationSeconds: number;
  createdAt: string;
}

/** A scene's place on the picture timeline. */
export interface SceneWindow {
  sceneNumber: number;
  start: number;
  end: number;
  description: string;
  /** Index into the ordered source assets of the scene's first shot, if any. */
  firstAssetIndex: number | null;
}

/** What the phone gets: the plan resolved against its pack, accent and fonts. */
export interface ManifestTextGraphics {
  style: TextGraphicStyleSpec;
  accent: string;
  fonts: { key: string; url: string; ascent: number; descent: number }[];
  items: TextGraphicItem[];
}

// ── Limits ───────────────────────────────────────────────────────────────────

export const TEXT_GRAPHIC_LIMITS = {
  title: 22,
  sub: 30,
  kicker: 26,
  num: 3,
  badge: 10,
  brand: 26,
  place: 32,
  maxLabels: 8,
  minSeconds: 1.4,
  /** Gap kept between two items, which share the top of the frame. */
  gapSeconds: 0.15,
} as const;

/** Count user-perceived characters, so a Thai vowel mark is not a character. */
export function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) {
    return Array.from(new Seg("th", { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

export function clipText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").replace(/[\u0000-\u001f]/g, "").trim();
  const parts = graphemes(clean);
  return parts.length <= max ? clean : parts.slice(0, max).join("").trim();
}

// ── Scene timeline ───────────────────────────────────────────────────────────

/**
 * Place the approved scenes on the picture timeline: each scene follows the
 * previous one minus the between-scene crossfade, exactly as the phone (and
 * `manifestPictureSeconds`) lays them out.
 */
export function sceneWindows(
  scenes: { sceneNumber?: number; seconds: number; description?: string; firstAssetIndex?: number | null }[],
  crossfadeSeconds: number
): SceneWindow[] {
  const windows: SceneWindow[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const seconds = Math.max(0, Number.isFinite(scene.seconds) ? scene.seconds : 0);
    const start = index === 0 ? 0 : Math.max(0, cursor - crossfadeSeconds);
    const end = start + seconds;
    windows.push({
      sceneNumber: scene.sceneNumber ?? index + 1,
      start: round2(start),
      end: round2(end),
      description: (scene.description ?? "").trim(),
      firstAssetIndex: scene.firstAssetIndex ?? null,
    });
    cursor = end;
  });
  return windows;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Fingerprint ──────────────────────────────────────────────────────────────

/** FNV-1a, twice with different seeds — a stable, dependency-free content key. */
export function stableHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function planFingerprint(input: {
  choice: TextGraphicChoice;
  windows: SceneWindow[];
  timeline: unknown;
  leadInSeconds: number;
  brand: string;
}): string {
  return stableHash(
    JSON.stringify({
      v: 1,
      c: input.choice,
      w: input.windows.map((w) => [w.start, w.end, w.firstAssetIndex]),
      t: input.timeline ?? null,
      l: input.leadInSeconds,
      b: input.brand,
    })
  );
}

// ── Sanitising ───────────────────────────────────────────────────────────────

function emptyItem(kind: TextGraphicKind): TextGraphicItem {
  return { kind, start: 0, end: 0, title: "", sub: "", kicker: "", num: "", badge: "", brand: "", place: "", position: "" };
}

/**
 * Repair whatever the model returned into a plan every renderer can draw:
 * known kinds only, texts trimmed to their budgets, times inside the video,
 * at most one hook and one CTA, no two items on screen at once (they share the
 * top of the frame), nothing shorter than `minSeconds`.
 */
export function sanitizeTextGraphicItems(raw: unknown, durationSeconds: number): TextGraphicItem[] {
  if (!Array.isArray(raw) || !(durationSeconds > 0)) return [];
  const L = TEXT_GRAPHIC_LIMITS;
  const items: TextGraphicItem[] = [];

  for (const entry of raw) {
    const obj = (entry ?? {}) as Record<string, unknown>;
    const kind = obj.kind;
    if (kind !== "hook" && kind !== "label" && kind !== "cta") continue;
    const start = Number(obj.start);
    const end = Number(obj.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const item: TextGraphicItem = {
      ...emptyItem(kind),
      start: round2(Math.max(0, start)),
      end: round2(Math.min(durationSeconds, end)),
      title: clipText(obj.title, kind === "cta" ? L.badge + 6 : L.title),
      sub: kind === "cta" ? "" : clipText(obj.sub, L.sub),
      kicker: kind === "hook" ? clipText(obj.kicker, L.kicker) : "",
      num: kind === "label" ? clipText(obj.num, L.num) : "",
      badge: kind === "label" ? clipText(obj.badge, L.badge) : "",
      brand: kind === "cta" ? clipText(obj.brand, L.brand) : "",
      place: kind === "cta" ? clipText(obj.place, L.place) : "",
      position: isTextGraphicPosition(obj.position) ? obj.position : "",
    };
    if (!item.title && !(kind === "cta" && item.brand)) continue;
    items.push(item);
  }

  items.sort((a, b) => a.start - b.start);

  const out: TextGraphicItem[] = [];
  let hooks = 0;
  let ctas = 0;
  let labels = 0;
  let badges = 0;
  for (const item of items) {
    if (item.kind === "hook" && hooks++ >= 1) continue;
    if (item.kind === "cta" && ctas++ >= 1) continue;
    if (item.kind === "label" && labels++ >= L.maxLabels) continue;
    const previous = out[out.length - 1];
    if (previous && item.start < previous.end + L.gapSeconds) {
      item.start = round2(previous.end + L.gapSeconds);
    }
    if (item.end - item.start < L.minSeconds) continue;
    if (item.badge && badges++ >= 3) item.badge = "";
    out.push(item);
  }
  return out;
}

/**
 * A plan with no AI at all: the business name as the opening hook, and a
 * closing card. Used when Claude is unavailable, so a chosen style never
 * silently produces nothing.
 */
export function fallbackTextGraphicItems(input: {
  durationSeconds: number;
  brand: string;
  hookLine: string;
  ctaTitle: string;
  place: string;
}): TextGraphicItem[] {
  const D = input.durationSeconds;
  if (!(D > 3)) return [];
  const items: unknown[] = [];
  const hookTitle = input.brand || input.hookLine;
  if (hookTitle) {
    items.push({
      kind: "hook",
      start: 0.3,
      end: Math.min(3.8, D * 0.35),
      title: hookTitle,
      sub: input.brand ? input.hookLine : "",
    });
  }
  const ctaLength = Math.max(2.5, Math.min(4, D * 0.15));
  if (D - ctaLength > 4) {
    items.push({
      kind: "cta",
      start: D - ctaLength,
      end: D,
      title: input.ctaTitle,
      brand: input.brand,
      place: input.place,
    });
  }
  return sanitizeTextGraphicItems(items, D);
}

/** Parse a stored plan, or null when absent or unreadable. */
export function parseTextGraphicsPlan(raw: string | null | undefined): TextGraphicsPlan | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<TextGraphicsPlan>;
    if (obj?.version !== 1 || !isTextGraphicStyleId(obj.styleId) || !Array.isArray(obj.items)) {
      return null;
    }
    return {
      version: 1,
      choice: isTextGraphicChoice(obj.choice) ? obj.choice : DEFAULT_TEXT_GRAPHIC_CHOICE,
      styleId: obj.styleId,
      items: sanitizeTextGraphicItems(obj.items, Number(obj.durationSeconds) || 0),
      source: obj.source === "claude" ? "claude" : "fallback",
      fingerprint: typeof obj.fingerprint === "string" ? obj.fingerprint : "",
      durationSeconds: Number(obj.durationSeconds) || 0,
      createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Resolve a plan into what the manifest carries. Null when there is nothing to draw. */
export function toManifestTextGraphics(
  plan: TextGraphicsPlan | null,
  paletteAccent: string,
  origin: string
): ManifestTextGraphics | null {
  if (!plan || plan.items.length === 0) return null;
  const style = getTextGraphicStyle(plan.styleId);
  const accent = /^#[0-9a-fA-F]{6}$/.test(style.accent ?? "")
    ? (style.accent as string)
    : /^#[0-9a-fA-F]{6}$/.test(paletteAccent)
      ? paletteAccent
      : "#D7262E";
  return {
    style,
    accent,
    fonts: fontsForStyle(style).map((font) => ({
      key: font.key,
      url: `${origin.replace(/\/+$/, "")}${textGraphicFontPath(font)}`,
      ascent: font.ascent,
      descent: font.descent,
    })),
    items: plan.items,
  };
}

export { TEXT_GRAPHIC_FONTS };

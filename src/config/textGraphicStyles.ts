/**
 * Text-graphic style packs.
 *
 * A style pack is the LOOK of the scene-matched text graphics — the hook title,
 * the per-scene labels with their badges, and the closing call-to-action card.
 * What the text SAYS and WHEN it shows comes from the per-request plan
 * (`src/lib/textGraphics/plan.ts`, written by Claude); the pack decides fonts,
 * colours, the frame around the words, how the words are drawn, where they sit
 * and how they move.
 *
 * A pack is pure data and travels in the render manifest as is. The phone
 * renderers (Android `TextGraphicsPainter`, iOS `TextGraphicsLayers`) and the
 * studio's canvas preview (`src/lib/textGraphics/canvasRenderer.ts`) all
 * interpret the same fields the same way, so a new pack — or a tweak to an
 * existing one — needs a server deploy but no app build, as long as it only
 * combines the frames, effects, positions and motions listed here.
 *
 * Sizes are reference pixels at a 1080-px short side, scaled by
 * `min(width, height) / 1080` exactly like the captions. Colours are
 * `#RRGGBB` or `#RRGGBBAA`, or the literal `"accent"` for the request's accent
 * colour (the pack's `accent` when set, else the template palette's accent).
 *
 * This is independent of the motion-graphic TEMPLATE (`motionTemplates.ts`):
 * the template is the frame and decoration of the whole video, the text style
 * is the words on top.
 */

export const TEXT_GRAPHIC_STYLE_IDS = [
  "premium",
  "street",
  "cafe",
  "note",
  "magazine",
  "slash",
  "minimal",
  "neon",
] as const;
export type TextGraphicStyleId = (typeof TEXT_GRAPHIC_STYLE_IDS)[number];

/** What the requester picks: a pack, "auto" (Claude picks), or "none". */
export const TEXT_GRAPHIC_CHOICES = ["auto", ...TEXT_GRAPHIC_STYLE_IDS, "none"] as const;
export type TextGraphicChoice = (typeof TEXT_GRAPHIC_CHOICES)[number];

/** New studio requests start on Auto; existing jobs (column default) stay "none". */
export const DEFAULT_TEXT_GRAPHIC_CHOICE: TextGraphicChoice = "auto";

export function isTextGraphicChoice(value: unknown): value is TextGraphicChoice {
  return typeof value === "string" && (TEXT_GRAPHIC_CHOICES as readonly string[]).includes(value);
}

export function isTextGraphicStyleId(value: unknown): value is TextGraphicStyleId {
  return typeof value === "string" && (TEXT_GRAPHIC_STYLE_IDS as readonly string[]).includes(value);
}

// ── Positions ────────────────────────────────────────────────────────────────

/**
 * Where an item sits. Captions own the bottom of the frame, so everything is
 * in the top band or at mid-height on a side. The pack sets a default per
 * item kind; the plan may move a label (Claude moves it off the main subject).
 */
export const TEXT_GRAPHIC_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-right",
] as const;
export type TextGraphicPosition = (typeof TEXT_GRAPHIC_POSITIONS)[number];

export function isTextGraphicPosition(value: unknown): value is TextGraphicPosition {
  return typeof value === "string" && (TEXT_GRAPHIC_POSITIONS as readonly string[]).includes(value);
}

// ── Fonts ────────────────────────────────────────────────────────────────────

/**
 * Fonts the packs use. Served from the web app's `public/fonts/` and downloaded
 * by the phone at render time (a failed download falls back to the system bold
 * face, so the text still renders). `ascent`/`descent` are fixed fractions of
 * the font size used for LAYOUT on every platform, instead of each platform's
 * own idea of the font's line metrics, so the boxes come out the same size on
 * Android, iOS and in the browser.
 */
export interface TextGraphicFont {
  key: string;
  file: string;
  ascent: number;
  descent: number;
}

export const TEXT_GRAPHIC_FONTS: Record<string, TextGraphicFont> = {
  "kanit-500": { key: "kanit-500", file: "Kanit-Medium.ttf", ascent: 1.02, descent: 0.34 },
  "kanit-700": { key: "kanit-700", file: "Kanit-Bold.ttf", ascent: 1.02, descent: 0.34 },
  "kanit-800": { key: "kanit-800", file: "Kanit-ExtraBold.ttf", ascent: 1.02, descent: 0.34 },
  "itim-400": { key: "itim-400", file: "Itim-Regular.ttf", ascent: 0.92, descent: 0.28 },
  "chonburi-400": { key: "chonburi-400", file: "Chonburi-Regular.ttf", ascent: 1.0, descent: 0.3 },
};

// ── Frames and text treatments ───────────────────────────────────────────────

/**
 * What the words of a hook or label sit in:
 *
 *   card      a rounded rectangle (optionally with a hard offset shadow)
 *   none      nothing — the words float, made readable by the text effect
 *   postit    a square sticky note with a strip of tape across the top
 *   painting  a gilded picture frame around a canvas
 *   ribbon    a banner with swallow-tail notched ends
 *   bubble    a speech bubble with a tail at the bottom-left
 *   slant     a parallelogram leaning right (frameWidth = the lean)
 */
export type TextGraphicFrame = "card" | "none" | "postit" | "painting" | "ribbon" | "bubble" | "slant";

/**
 * How the hook and label text itself is drawn. `marker` sweeps a highlighter
 * stroke (the textEffect colour) across the lower half of big words and gives
 * small words a soft dark shadow.
 */
export type TextGraphicTextEffect = "plain" | "shadow" | "outline" | "glow" | "marker";

// ── Motion ───────────────────────────────────────────────────────────────────

/**
 * How one part enters, as a function of its own progress p = (t - delay) / dur:
 *
 *   rise   the part slides up into view from below its own box, clipped to it
 *   wipe   revealed left-to-right (children included)
 *   pop    scales up from 0 with overshoot about its anchor
 *   fade   fades in while rising 16 px
 *   growX  scales its width from 0 at its left edge
 *   growY  scales its height from 0 at its top edge
 *   drop   falls 40 px into place with overshoot
 *
 * rise/wipe/fade/growX/growY ease out (cubic); pop/drop use the back curve.
 */
export type TextGraphicEnter = "rise" | "wipe" | "pop" | "fade" | "growX" | "growY" | "drop";

export interface TextGraphicAnim {
  kind: TextGraphicEnter;
  /** Seconds after the item's start. */
  delay: number;
  /** Seconds. */
  dur: number;
}

/** Loops once the item has been on screen 1 s. `amp` is degrees / ref px / scale fraction. */
export interface TextGraphicIdle {
  kind: "none" | "wobble" | "float" | "pulse";
  amp: number;
  period: number;
}

export interface TextGraphicExit {
  kind: "slideLeft" | "shrink" | "fade";
  dur: number;
}

export interface TextGraphicStyleSpec {
  id: TextGraphicStyleId;
  /** Fixed accent, or null for the template palette's accent. */
  accent: string | null;
  fonts: {
    title: string;
    body: string;
    badge: string;
    hook: string;
  };
  sizes: {
    title: number;
    sub: number;
    num: number;
    kicker: number;
    hookTitle: number;
    hookSub: number;
    badgeText: number;
    badgeDiameter: number;
    ctaBrand: number;
    ctaPlace: number;
    ctaButton: number;
  };
  colors: {
    cardBg: string;
    title: string;
    sub: string;
    num: string;
    bar: string;
    underline: string;
    hookBg: string;
    hookTitle: string;
    hookSub: string;
    kickerBg: string;
    kickerText: string;
    dot: string;
    badgeBg: string;
    badgeText: string;
    badgeRing: string;
    ctaBg: string;
    ctaBrand: string;
    ctaPlace: string;
    pin: string;
    buttonBg: string;
    buttonText: string;
    /** Hard (unblurred) offset shadow under panels; `shadowDx/Dy` 0 = none. */
    shadow: string;
    /** Painting: the gilded moulding; ribbon/bubble/postit ignore it. */
    frame: string;
    /** Painting: the dark lines in the moulding. */
    frameInner: string;
    /** Painting: the highlight line and the corner ornaments. */
    frameAccent: string;
    /** Painting: the white mat between the moulding and the canvas. */
    frameMat: string;
    /** Post-it: the strip of tape. */
    tape: string;
    /** Shadow / outline / glow colour of the text effect. */
    textEffect: string;
  };
  shape: {
    frame: TextGraphicFrame;
    /** Painting: moulding width. Ribbon: notch depth. Ref px. */
    frameWidth: number;
    textEffect: TextGraphicTextEffect;
    cardRadius: number;
    /** Accent bar left of the label panel; 0 = no bar. */
    barWidth: number;
    underline: boolean;
    badge: "circle" | "burst" | "tag";
    badgeRotate: number;
    /** Whole-item tilt in degrees (sticker look); 0 = straight. */
    tiltDeg: number;
    shadowDx: number;
    shadowDy: number;
    ctaRadius: number;
    hookDot: boolean;
    uppercaseSub: boolean;
  };
  /** Default place for each item kind; a label's plan may override it. */
  positions: {
    hook: TextGraphicPosition;
    label: TextGraphicPosition;
    cta: TextGraphicPosition;
  };
  motion: {
    bar: TextGraphicAnim;
    card: TextGraphicAnim;
    num: TextGraphicAnim;
    title: TextGraphicAnim;
    underline: TextGraphicAnim;
    sub: TextGraphicAnim;
    badge: TextGraphicAnim;
    hookBox: TextGraphicAnim;
    kicker: TextGraphicAnim;
    dot: TextGraphicAnim;
    hookTitle: TextGraphicAnim;
    hookSub: TextGraphicAnim;
    ctaCard: TextGraphicAnim;
    pin: TextGraphicAnim;
    ctaText: TextGraphicAnim;
    button: TextGraphicAnim;
    badgeIdle: TextGraphicIdle;
    buttonIdle: TextGraphicIdle;
    exit: TextGraphicExit;
  };
}

const a = (kind: TextGraphicEnter, delay: number, dur: number): TextGraphicAnim => ({
  kind,
  delay,
  dur,
});

const NO_COLOR = "#00000000";

/** Motion shared by the calm packs: masked slide-ups, wipe-in panel, stamp pop. */
const SLIDE_MOTION: TextGraphicStyleSpec["motion"] = {
  bar: a("growY", 0, 0.25),
  card: a("wipe", 0.08, 0.4),
  num: a("rise", 0.12, 0.35),
  title: a("rise", 0.18, 0.45),
  underline: a("growX", 0.4, 0.5),
  sub: a("rise", 0.32, 0.4),
  badge: a("pop", 0.55, 0.45),
  hookBox: a("wipe", 0, 0.35),
  kicker: a("rise", 0.05, 0.35),
  dot: a("pop", 0.1, 0.45),
  hookTitle: a("rise", 0.18, 0.55),
  hookSub: a("rise", 0.45, 0.45),
  ctaCard: a("drop", 0, 0.45),
  pin: a("drop", 0.25, 0.5),
  ctaText: a("fade", 0.3, 0.4),
  button: a("pop", 0.45, 0.4),
  badgeIdle: { kind: "wobble", amp: 4, period: 1.4 },
  buttonIdle: { kind: "pulse", amp: 0.05, period: 1.1 },
  exit: { kind: "slideLeft", dur: 0.35 },
};

/** Motion shared by the playful packs: everything bounces in. */
const POP_MOTION: TextGraphicStyleSpec["motion"] = {
  bar: a("pop", 0, 0.3),
  card: a("pop", 0, 0.38),
  num: a("pop", 0.1, 0.3),
  title: a("pop", 0.12, 0.35),
  underline: a("growX", 0.3, 0.3),
  sub: a("pop", 0.22, 0.3),
  badge: a("pop", 0.32, 0.4),
  hookBox: a("pop", 0, 0.38),
  kicker: a("pop", 0.1, 0.3),
  dot: a("pop", 0.1, 0.3),
  hookTitle: a("pop", 0.16, 0.38),
  hookSub: a("pop", 0.28, 0.32),
  ctaCard: a("pop", 0, 0.4),
  pin: a("drop", 0.2, 0.45),
  ctaText: a("pop", 0.25, 0.35),
  button: a("pop", 0.35, 0.4),
  badgeIdle: { kind: "wobble", amp: 7, period: 0.9 },
  buttonIdle: { kind: "pulse", amp: 0.08, period: 0.7 },
  exit: { kind: "shrink", dur: 0.25 },
};

/** Motion shared by the soft packs: slow fades and a gentle float. */
const SOFT_MOTION: TextGraphicStyleSpec["motion"] = {
  bar: a("fade", 0, 0.5),
  card: a("fade", 0, 0.6),
  num: a("fade", 0.15, 0.6),
  title: a("fade", 0.2, 0.6),
  underline: a("growX", 0.5, 0.7),
  sub: a("fade", 0.35, 0.6),
  badge: a("fade", 0.6, 0.6),
  hookBox: a("fade", 0, 0.6),
  kicker: a("fade", 0.15, 0.6),
  dot: a("fade", 0.15, 0.6),
  hookTitle: a("fade", 0.25, 0.7),
  hookSub: a("fade", 0.45, 0.6),
  ctaCard: a("fade", 0, 0.6),
  pin: a("fade", 0.2, 0.6),
  ctaText: a("fade", 0.3, 0.6),
  button: a("fade", 0.45, 0.6),
  badgeIdle: { kind: "float", amp: 6, period: 2.4 },
  buttonIdle: { kind: "float", amp: 4, period: 2.4 },
  exit: { kind: "fade", dur: 0.5 },
};

const BASE_SIZES: TextGraphicStyleSpec["sizes"] = {
  title: 60,
  sub: 28,
  num: 28,
  kicker: 24,
  hookTitle: 70,
  hookSub: 34,
  badgeText: 32,
  badgeDiameter: 150,
  ctaBrand: 46,
  ctaPlace: 30,
  ctaButton: 42,
};

/**
 * PREMIUM — clean and editorial: dark glass card, an accent bar, a circular
 * stamp, masked slide-up text. Restaurants, hotels, spas, anything upmarket.
 */
const PREMIUM: TextGraphicStyleSpec = {
  id: "premium",
  accent: null,
  fonts: { title: "kanit-700", body: "kanit-500", badge: "kanit-800", hook: "kanit-800" },
  sizes: BASE_SIZES,
  colors: {
    cardBg: "#0E0C0CC7",
    title: "#FFFFFF",
    sub: "#F3D9C9",
    num: "accent",
    bar: "accent",
    underline: "accent",
    hookBg: "#0A0808B3",
    hookTitle: "#FFFFFF",
    hookSub: "#FFFFFF",
    kickerBg: "accent",
    kickerText: "#FFFFFF",
    dot: "accent",
    badgeBg: "accent",
    badgeText: "#FFFFFF",
    badgeRing: "#FFFFFFC0",
    ctaBg: "#FFFFFF",
    ctaBrand: "#1A1414",
    ctaPlace: "#6B5A55",
    pin: "accent",
    buttonBg: "accent",
    buttonText: "#FFFFFF",
    shadow: NO_COLOR,
    frame: NO_COLOR,
    frameInner: NO_COLOR,
    frameAccent: NO_COLOR,
    frameMat: NO_COLOR,
    tape: NO_COLOR,
    textEffect: NO_COLOR,
  },
  shape: {
    frame: "card",
    frameWidth: 0,
    textEffect: "plain",
    cardRadius: 22,
    barWidth: 12,
    underline: true,
    badge: "circle",
    badgeRotate: -14,
    tiltDeg: 0,
    shadowDx: 0,
    shadowDy: 0,
    ctaRadius: 30,
    hookDot: true,
    uppercaseSub: true,
  },
  positions: { hook: "top-left", label: "top-left", cta: "top-center" },
  motion: SLIDE_MOTION,
};

/**
 * STREET FOOD — loud and fun: yellow ribbon banners with a hard black shadow,
 * a slight tilt, starburst badges, everything bouncing in. Stalls, markets,
 * fast food, promotions.
 */
const STREET: TextGraphicStyleSpec = {
  id: "street",
  accent: "#E5262A",
  fonts: { title: "kanit-800", body: "kanit-700", badge: "kanit-800", hook: "kanit-800" },
  sizes: { ...BASE_SIZES, title: 64, hookTitle: 76, badgeText: 34, badgeDiameter: 168, ctaBrand: 48, ctaButton: 44 },
  colors: {
    cardBg: "#FFD400",
    title: "#111111",
    sub: "#3A2E00",
    num: "accent",
    bar: "accent",
    underline: "#111111",
    hookBg: "#FFD400",
    hookTitle: "#111111",
    hookSub: "#3A2E00",
    kickerBg: "#111111",
    kickerText: "#FFD400",
    dot: "accent",
    badgeBg: "accent",
    badgeText: "#FFFFFF",
    badgeRing: NO_COLOR,
    ctaBg: "#FFD400",
    ctaBrand: "#111111",
    ctaPlace: "#3A2E00",
    pin: "accent",
    buttonBg: "accent",
    buttonText: "#FFFFFF",
    shadow: "#111111",
    frame: NO_COLOR,
    frameInner: NO_COLOR,
    frameAccent: NO_COLOR,
    frameMat: NO_COLOR,
    tape: NO_COLOR,
    textEffect: NO_COLOR,
  },
  shape: {
    frame: "ribbon",
    frameWidth: 30,
    textEffect: "plain",
    cardRadius: 10,
    barWidth: 0,
    underline: false,
    badge: "burst",
    badgeRotate: 10,
    tiltDeg: -2.5,
    shadowDx: 9,
    shadowDy: 9,
    ctaRadius: 14,
    hookDot: false,
    uppercaseSub: true,
  },
  positions: { hook: "top-left", label: "top-right", cta: "top-center" },
  motion: POP_MOTION,
};

/**
 * CAFÉ — soft and handmade: cream speech bubbles, a rounded handwritten-style
 * Thai face, tag-shaped badges, slow fades and a gentle float. Cafés,
 * bakeries, desserts, florists, anything cosy.
 */
const CAFE: TextGraphicStyleSpec = {
  id: "cafe",
  accent: "#C8754B",
  fonts: { title: "itim-400", body: "itim-400", badge: "itim-400", hook: "itim-400" },
  sizes: { ...BASE_SIZES, title: 64, sub: 30, num: 30, kicker: 28, hookTitle: 76, hookSub: 36, badgeText: 34, ctaBrand: 48, ctaPlace: 32 },
  colors: {
    cardBg: "#FFF6E9F2",
    title: "#5B3A29",
    sub: "#9A6B4F",
    num: "accent",
    bar: "accent",
    underline: "accent",
    hookBg: "#FFF6E9F2",
    hookTitle: "#5B3A29",
    hookSub: "#9A6B4F",
    kickerBg: "accent",
    kickerText: "#FFFFFF",
    dot: "accent",
    badgeBg: "accent",
    badgeText: "#FFFFFF",
    badgeRing: "#FFFFFFB0",
    ctaBg: "#FFF6E9",
    ctaBrand: "#5B3A29",
    ctaPlace: "#9A6B4F",
    pin: "accent",
    buttonBg: "accent",
    buttonText: "#FFFFFF",
    shadow: NO_COLOR,
    frame: NO_COLOR,
    frameInner: NO_COLOR,
    frameAccent: NO_COLOR,
    frameMat: NO_COLOR,
    tape: NO_COLOR,
    textEffect: NO_COLOR,
  },
  shape: {
    frame: "bubble",
    frameWidth: 0,
    textEffect: "plain",
    cardRadius: 40,
    barWidth: 0,
    underline: true,
    badge: "tag",
    badgeRotate: -8,
    tiltDeg: 0,
    shadowDx: 0,
    shadowDy: 0,
    ctaRadius: 44,
    hookDot: false,
    uppercaseSub: false,
  },
  positions: { hook: "top-left", label: "middle-left", cta: "top-center" },
  motion: SOFT_MOTION,
};

/**
 * POST-IT — a yellow sticky note taped to the video, handwritten words,
 * slightly crooked. Tips, menus, recommendations, home-made and DIY shops.
 */
const NOTE: TextGraphicStyleSpec = {
  id: "note",
  accent: "#E2442F",
  fonts: { title: "itim-400", body: "itim-400", badge: "itim-400", hook: "itim-400" },
  sizes: { ...BASE_SIZES, title: 66, sub: 32, kicker: 28, hookTitle: 74, hookSub: 36, badgeText: 34 },
  colors: {
    cardBg: "#FFE873",
    title: "#2B2B2B",
    sub: "#5A4F1E",
    num: "accent",
    bar: "accent",
    underline: "accent",
    hookBg: "#FFE873",
    hookTitle: "#2B2B2B",
    hookSub: "#5A4F1E",
    kickerBg: "accent",
    kickerText: "#FFFFFF",
    dot: "accent",
    badgeBg: "accent",
    badgeText: "#FFFFFF",
    badgeRing: "#FFFFFFB0",
    ctaBg: "#FFE873",
    ctaBrand: "#2B2B2B",
    ctaPlace: "#5A4F1E",
    pin: "accent",
    buttonBg: "accent",
    buttonText: "#FFFFFF",
    shadow: "#00000040",
    frame: NO_COLOR,
    frameInner: NO_COLOR,
    frameAccent: NO_COLOR,
    frameMat: NO_COLOR,
    tape: "#FFFFFFA6",
    textEffect: NO_COLOR,
  },
  shape: {
    frame: "postit",
    frameWidth: 0,
    textEffect: "plain",
    cardRadius: 4,
    barWidth: 0,
    underline: true,
    badge: "tag",
    badgeRotate: 8,
    tiltDeg: -3,
    shadowDx: 6,
    shadowDy: 10,
    ctaRadius: 6,
    hookDot: false,
    uppercaseSub: false,
  },
  positions: { hook: "top-left", label: "top-right", cta: "top-center" },
  motion: {
    ...SOFT_MOTION,
    card: a("drop", 0, 0.45),
    hookBox: a("drop", 0, 0.45),
    ctaCard: a("drop", 0, 0.45),
    badge: a("pop", 0.45, 0.4),
    badgeIdle: { kind: "wobble", amp: 3, period: 1.8 },
    exit: { kind: "fade", dur: 0.35 },
  },
};

/**
 * MINIMAL — no frame at all: big white words with a soft shadow straight on
 * the picture and a thin accent underline. Modern shops, fashion, real estate.
 */
const MINIMAL: TextGraphicStyleSpec = {
  id: "minimal",
  accent: null,
  fonts: { title: "kanit-800", body: "kanit-500", badge: "kanit-800", hook: "kanit-800" },
  sizes: { ...BASE_SIZES, title: 72, sub: 30, hookTitle: 84, hookSub: 36 },
  colors: {
    cardBg: NO_COLOR,
    title: "#FFFFFF",
    sub: "#FFFFFF",
    num: "accent",
    bar: "accent",
    underline: "accent",
    hookBg: NO_COLOR,
    hookTitle: "#FFFFFF",
    hookSub: "#FFFFFF",
    kickerBg: "accent",
    kickerText: "#FFFFFF",
    dot: "accent",
    badgeBg: "#FFFFFF",
    badgeText: "#111111",
    badgeRing: NO_COLOR,
    ctaBg: "#111111D9",
    ctaBrand: "#FFFFFF",
    ctaPlace: "#D0D0D0",
    pin: "accent",
    buttonBg: "accent",
    buttonText: "#FFFFFF",
    shadow: NO_COLOR,
    frame: NO_COLOR,
    frameInner: NO_COLOR,
    frameAccent: NO_COLOR,
    frameMat: NO_COLOR,
    tape: NO_COLOR,
    textEffect: "#000000B8",
  },
  shape: {
    frame: "none",
    frameWidth: 0,
    textEffect: "shadow",
    cardRadius: 0,
    barWidth: 0,
    underline: true,
    badge: "tag",
    badgeRotate: 0,
    tiltDeg: 0,
    shadowDx: 0,
    shadowDy: 0,
    ctaRadius: 999,
    hookDot: false,
    uppercaseSub: true,
  },
  positions: { hook: "middle-left", label: "top-center", cta: "top-center" },
  motion: { ...SLIDE_MOTION, badgeIdle: { kind: "none", amp: 0, period: 0 } },
};

/**
 * NEON — glowing sign-style words on the night: pink and cyan glow, no frame,
 * starburst badges. Bars, night markets, karaoke, events.
 */
const NEON: TextGraphicStyleSpec = {
  id: "neon",
  accent: "#FF2BD6",
  fonts: { title: "kanit-700", body: "kanit-500", badge: "kanit-800", hook: "kanit-800" },
  sizes: { ...BASE_SIZES, title: 68, sub: 30, hookTitle: 80, hookSub: 34, badgeDiameter: 160 },
  colors: {
    cardBg: NO_COLOR,
    title: "#FFF5FD",
    sub: "#9DFBFF",
    num: "#9DFBFF",
    bar: "accent",
    underline: "#9DFBFF",
    hookBg: NO_COLOR,
    hookTitle: "#FFF5FD",
    hookSub: "#9DFBFF",
    kickerBg: "#9DFBFF",
    kickerText: "#120820",
    dot: "accent",
    badgeBg: "accent",
    badgeText: "#FFFFFF",
    badgeRing: NO_COLOR,
    ctaBg: "#120820E6",
    ctaBrand: "#FFF5FD",
    ctaPlace: "#9DFBFF",
    pin: "accent",
    buttonBg: "accent",
    buttonText: "#FFFFFF",
    shadow: NO_COLOR,
    frame: NO_COLOR,
    frameInner: NO_COLOR,
    frameAccent: NO_COLOR,
    frameMat: NO_COLOR,
    tape: NO_COLOR,
    textEffect: "accent",
  },
  shape: {
    frame: "none",
    frameWidth: 0,
    textEffect: "glow",
    cardRadius: 0,
    barWidth: 0,
    underline: true,
    badge: "burst",
    badgeRotate: 12,
    tiltDeg: 0,
    shadowDx: 0,
    shadowDy: 0,
    ctaRadius: 24,
    hookDot: false,
    uppercaseSub: true,
  },
  positions: { hook: "top-center", label: "middle-right", cta: "top-center" },
  motion: { ...POP_MOTION, exit: { kind: "fade", dur: 0.3 }, badgeIdle: { kind: "pulse", amp: 0.06, period: 0.8 } },
};

/**
 * MAGAZINE — no box at all: huge white words with a yellow highlighter stroke
 * swept across them, like a lifestyle-magazine cover line. Small caps above.
 */
const MAGAZINE: TextGraphicStyleSpec = {
  id: "magazine",
  accent: "#FFD23F",
  fonts: { title: "kanit-800", body: "kanit-700", badge: "kanit-800", hook: "kanit-800" },
  sizes: { ...BASE_SIZES, title: 82, sub: 30, num: 34, hookTitle: 92, hookSub: 34, badgeDiameter: 150 },
  colors: {
    cardBg: NO_COLOR,
    title: "#FFFFFF",
    sub: "#FFFFFF",
    num: "accent",
    bar: "accent",
    underline: "accent",
    hookBg: NO_COLOR,
    hookTitle: "#FFFFFF",
    hookSub: "#FFFFFF",
    kickerBg: "accent",
    kickerText: "#111111",
    dot: "accent",
    badgeBg: "#111111",
    badgeText: "#FFD23F",
    badgeRing: NO_COLOR,
    ctaBg: "#111111E6",
    ctaBrand: "#FFFFFF",
    ctaPlace: "#FFD23F",
    pin: "accent",
    buttonBg: "accent",
    buttonText: "#111111",
    shadow: NO_COLOR,
    frame: NO_COLOR,
    frameInner: NO_COLOR,
    frameAccent: NO_COLOR,
    frameMat: NO_COLOR,
    tape: NO_COLOR,
    textEffect: "#FFD23FD9",
  },
  shape: {
    frame: "none",
    frameWidth: 0,
    textEffect: "marker",
    cardRadius: 0,
    barWidth: 0,
    underline: false,
    badge: "tag",
    badgeRotate: -6,
    tiltDeg: 0,
    shadowDx: 0,
    shadowDy: 0,
    ctaRadius: 999,
    hookDot: false,
    uppercaseSub: true,
  },
  positions: { hook: "middle-right", label: "top-right", cta: "top-center" },
  motion: {
    ...SLIDE_MOTION,
    title: a("wipe", 0.1, 0.5),
    hookTitle: a("wipe", 0.1, 0.55),
    badgeIdle: { kind: "none", amp: 0, period: 0 },
  },
};

/**
 * SLASH — sporty and fast: a black parallelogram slashing across the frame
 * with a bright orange stripe behind it, white heavy words. Gyms, sports bars,
 * delivery, flash deals.
 */
const SLASH: TextGraphicStyleSpec = {
  id: "slash",
  accent: "#FF5A1F",
  fonts: { title: "kanit-800", body: "kanit-700", badge: "kanit-800", hook: "kanit-800" },
  sizes: { ...BASE_SIZES, title: 66, sub: 28, hookTitle: 76, hookSub: 32, badgeDiameter: 160 },
  colors: {
    cardBg: "#111111",
    title: "#FFFFFF",
    sub: "accent",
    num: "accent",
    bar: "accent",
    underline: "accent",
    hookBg: "#111111",
    hookTitle: "#FFFFFF",
    hookSub: "accent",
    kickerBg: "accent",
    kickerText: "#FFFFFF",
    dot: "accent",
    badgeBg: "accent",
    badgeText: "#FFFFFF",
    badgeRing: NO_COLOR,
    ctaBg: "#111111",
    ctaBrand: "#FFFFFF",
    ctaPlace: "accent",
    pin: "accent",
    buttonBg: "accent",
    buttonText: "#FFFFFF",
    shadow: "accent",
    frame: NO_COLOR,
    frameInner: NO_COLOR,
    frameAccent: NO_COLOR,
    frameMat: NO_COLOR,
    tape: NO_COLOR,
    textEffect: NO_COLOR,
  },
  shape: {
    frame: "slant",
    frameWidth: 34,
    textEffect: "plain",
    cardRadius: 0,
    barWidth: 0,
    underline: false,
    badge: "burst",
    badgeRotate: 8,
    tiltDeg: 0,
    shadowDx: 12,
    shadowDy: 12,
    ctaRadius: 8,
    hookDot: false,
    uppercaseSub: true,
  },
  positions: { hook: "top-right", label: "middle-right", cta: "top-center" },
  motion: {
    ...SLIDE_MOTION,
    card: a("wipe", 0, 0.3),
    hookBox: a("wipe", 0, 0.3),
    title: a("rise", 0.12, 0.35),
    sub: a("rise", 0.22, 0.3),
    badge: a("pop", 0.35, 0.35),
    badgeIdle: { kind: "pulse", amp: 0.06, period: 0.8 },
  },
};

export const TEXT_GRAPHIC_STYLES: Record<TextGraphicStyleId, TextGraphicStyleSpec> = {
  premium: PREMIUM,
  street: STREET,
  cafe: CAFE,
  note: NOTE,
  minimal: MINIMAL,
  neon: NEON,
  magazine: MAGAZINE,
  slash: SLASH,
};

/** One line per pack, for the prompt that asks Claude to choose. */
export const TEXT_GRAPHIC_STYLE_GUIDE: Record<TextGraphicStyleId, string> = {
  premium: "calm, elegant, upmarket — dark glass cards; fine dining, Japanese, hotels, spas, boutiques",
  street: "loud, fun, energetic — yellow ribbon banners; street food, markets, fast food, promotions",
  cafe: "soft, cosy, handmade — cream speech bubbles; cafés, bakeries, desserts, florists",
  note: "friendly tips on a yellow sticky note — menus, recommendations, home-made or DIY shops",
  minimal: "modern, clean — big white words with no frame; fashion, beauty, real estate, modern shops",
  neon: "night-time glow — neon sign words; bars, night markets, karaoke, events",
  magazine: "lifestyle-magazine cover lines — huge white words with a yellow highlighter, no box",
  slash: "sporty, fast — a black slanted block with an orange stripe; gyms, sports bars, delivery, flash deals",
};

export function getTextGraphicStyle(id: TextGraphicStyleId): TextGraphicStyleSpec {
  return TEXT_GRAPHIC_STYLES[id] ?? PREMIUM;
}

/** The font keys a pack draws with, deduplicated. */
export function fontsForStyle(style: TextGraphicStyleSpec): TextGraphicFont[] {
  const keys = new Set(Object.values(style.fonts));
  return [...keys].map((key) => TEXT_GRAPHIC_FONTS[key]).filter(Boolean);
}

/** Where the font files are served, relative to the app origin. */
export function textGraphicFontPath(font: TextGraphicFont): string {
  return `/fonts/${font.file}`;
}

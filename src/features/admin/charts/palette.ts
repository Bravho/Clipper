/**
 * Chart palette and chrome tokens for the admin analytics surface.
 *
 * Chosen so that identity is never carried by hue alone and the colours stay
 * distinguishable under colour-vision deficiency. The four categorical slots
 * were validated against the white card surface the admin pages actually render
 * on (`bg-white`), not a generic grey:
 *
 *   lightness band  PASS — all four inside L 0.43–0.77
 *   chroma floor    PASS — all four >= 0.1
 *   CVD separation  PASS — worst adjacent pair ΔE 9.1 (protan)
 *   normal vision   PASS — worst adjacent pair ΔE 22.9
 *   contrast        WARN — aqua (2.82:1) and yellow (2.17:1) sit below 3:1
 *
 * That contrast warning is not dismissable: it obliges "relief". Every chart in
 * this folder therefore ships either direct value labels or the same numbers in
 * a table on the page beside it. Do not add a chart here that shows a value ONLY
 * as a coloured mark.
 *
 * Slot order is the CVD-safety mechanism, not decoration — assign slots in the
 * order given and never cycle. A fifth series folds into "Other" or becomes a
 * second chart; adding a fifth hue silently breaks the validated pairs.
 *
 * The app has no dark mode today (no `dark:` utilities, no `darkMode` in the
 * Tailwind config), so only the light steps are wired up. The dark steps are
 * recorded alongside them so a future dark mode is a substitution rather than a
 * re-derivation — they are separately chosen for the dark surface, not a flip.
 */

/** Categorical series colours, in fixed assignment order. */
export const SERIES = {
  /** Slot 1 — the default single-series colour. */
  blue: "#2a78d6",
  /** Slot 2. */
  orange: "#eb6834",
  /** Slot 3. */
  aqua: "#1baf7a",
  /** Slot 4. Sits beside orange — needs direct labels when both are on screen. */
  yellow: "#eda100",
} as const;

/** Ordered slot list, for `SERIES_ORDER[i]` assignment. */
export const SERIES_ORDER: string[] = [
  SERIES.blue,
  SERIES.orange,
  SERIES.aqua,
  SERIES.yellow,
];

/** Dark-surface steps for the same four hues. Unused until dark mode exists. */
export const SERIES_DARK: string[] = ["#3987e5", "#d95926", "#199e70", "#c98500"];

/**
 * Single-hue blue ramp for magnitude (heatmap cells, funnel stages).
 *
 * For ORDINAL use — discrete ordered marks like funnel stages — the lightest
 * step must still clear 2:1 against the surface, so start no lighter than
 * `ordinal[0]`. The full ramp including the near-surface steps is only for
 * continuous sequential encoding where "lightest" legitimately means "≈ zero".
 */
export const SEQUENTIAL_BLUE = {
  /** Continuous: heatmap cells, where the palest step means "almost nothing". */
  continuous: [
    "#cde2fb",
    "#b7d3f6",
    "#9ec5f4",
    "#86b6ef",
    "#6da7ec",
    "#5598e7",
    "#3987e5",
    "#2a78d6",
    "#256abf",
    "#1c5cab",
  ],
  /** Ordinal: funnel stages and tiers. Nothing lighter than 2:1 on white. */
  ordinal: ["#86b6ef", "#5598e7", "#2a78d6", "#256abf", "#184f95", "#104281"],
} as const;

/**
 * Status colours. Reserved — never reused as "series 5".
 *
 * Always paired with an icon or a word. On a white surface `warning` and
 * `serious` are deliberately below 3:1, so the label is what carries the
 * meaning; the colour only reinforces it.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  /** Success text needs real contrast, so it is a darker step than `good`. */
  goodText: "#006300",
} as const;

/** Chart chrome. Matches the slate palette the admin pages already use. */
export const CHROME = {
  surface: "#ffffff",
  grid: "#e2e8f0", // slate-200
  axis: "#cbd5e1", // slate-300
  muted: "#94a3b8", // slate-400 — axis ticks and labels
  secondary: "#475569", // slate-600
  primary: "#0f172a", // slate-900
} as const;

/** Pick a sequential step for `value` within `[0, max]`. */
export function sequentialStep(value: number, max: number): string {
  const ramp = SEQUENTIAL_BLUE.continuous;
  if (!Number.isFinite(max) || max <= 0 || value <= 0) return "#f1f5f9"; // slate-100 = empty
  const index = Math.min(ramp.length - 1, Math.floor((value / max) * ramp.length));
  return ramp[index];
}

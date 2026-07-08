/**
 * Maps a distribution-channel aspect-ratio string (as produced by
 * PLATFORM_ASPECT_RATIOS for the user's selected primary channel) to a Tailwind
 * aspect-ratio class.
 *
 * Literal class strings are required so Tailwind's JIT compiler keeps them —
 * a dynamically built `aspect-[${x}]` would be purged from the build.
 *
 * The ratio itself is NOT fixed here: callers pass the ratio of whichever
 * primary channel the user actually selected (TikTok, Instagram, YouTube, …),
 * so the preview reflects that channel's shape.
 */
const ASPECT_CLASS: Record<string, string> = {
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-video",
  "1:1": "aspect-square",
  "4:5": "aspect-[4/5]",
  "4:3": "aspect-[4/3]",
};

/** Falls back to 9:16 (the most common short-video shape) for unknown/empty. */
export function aspectRatioClass(ratio: string | null | undefined): string {
  return (ratio && ASPECT_CLASS[ratio]) || "aspect-[9/16]";
}

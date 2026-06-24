import type { StoryboardScene } from "@/domain/models/VideoGenerationJob";

/**
 * Pure helpers for the Stage-1 storyboard (rough, pre-voice visual plan).
 *
 * Kept free of network/AI deps so they're unit-testable and can serve as the
 * deterministic fallback whenever the Vision model is unavailable or returns
 * something unusable — the pipeline must never block on storyboard quality.
 */

/**
 * Build a deterministic storyboard by distributing the ordered source assets
 * across up to `targetScenes` scenes (in canonical index order). With no
 * assets, returns a single empty scene so downstream code always has one.
 */
export function buildFallbackStoryboard(assetCount: number, targetScenes = 3): StoryboardScene[] {
  if (!Number.isFinite(assetCount) || assetCount <= 0) {
    return [{ sceneNumber: 1, summary: "", assetIndexes: [] }];
  }

  const scenes = Math.max(1, Math.min(targetScenes, assetCount));
  const perScene = Math.ceil(assetCount / scenes);
  const result: StoryboardScene[] = [];
  let idx = 0;

  for (let s = 0; s < scenes && idx < assetCount; s++) {
    const assetIndexes: number[] = [];
    for (let k = 0; k < perScene && idx < assetCount; k++) assetIndexes.push(idx++);
    result.push({ sceneNumber: result.length + 1, summary: "", assetIndexes });
  }

  return result;
}

/**
 * Validate/repair a raw (e.g. AI-produced) storyboard against the known asset
 * count: drop out-of-range asset indexes, coerce summaries to strings, and
 * renumber scenes contiguously. Falls back to `buildFallbackStoryboard` when
 * the input is unusable.
 */
export function sanitizeStoryboard(raw: unknown, assetCount: number): StoryboardScene[] {
  if (!Array.isArray(raw)) return buildFallbackStoryboard(assetCount);

  const cleaned: StoryboardScene[] = raw
    .map((entry) => {
      const obj = (entry ?? {}) as Record<string, unknown>;
      const assetIndexes = Array.isArray(obj.assetIndexes)
        ? (obj.assetIndexes as unknown[]).filter(
            (n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < assetCount
          )
        : [];
      const scene: StoryboardScene = {
        sceneNumber: 0, // renumbered below
        summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
        assetIndexes,
      };
      if (Number.isFinite(obj.roughDurationHint)) {
        scene.roughDurationHint = Number(obj.roughDurationHint);
      }
      return scene;
    })
    .filter((s) => s.summary.length > 0 || s.assetIndexes.length > 0)
    .map((s, i) => ({ ...s, sceneNumber: i + 1 }));

  const result = cleaned.length > 0 ? cleaned : buildFallbackStoryboard(assetCount);
  return ensureAllAssetsUsed(result, assetCount);
}

/**
 * Guarantee every uploaded asset (0..assetCount-1) appears in at least one
 * scene. The AI often references only the first image; any unused asset is
 * appended to the scene that currently has the fewest assets (balanced fill),
 * so no uploaded photo/clip is silently dropped from the storyboard.
 */
export function ensureAllAssetsUsed(
  scenes: StoryboardScene[],
  assetCount: number
): StoryboardScene[] {
  if (assetCount <= 0 || scenes.length === 0) return scenes;

  const used = new Set<number>();
  for (const scene of scenes) for (const idx of scene.assetIndexes) used.add(idx);

  const missing: number[] = [];
  for (let i = 0; i < assetCount; i++) if (!used.has(i)) missing.push(i);
  if (missing.length === 0) return scenes;

  const result = scenes.map((s) => ({ ...s, assetIndexes: [...s.assetIndexes] }));
  for (const idx of missing) {
    let target = 0;
    let fewest = Infinity;
    for (let k = 0; k < result.length; k++) {
      if (result[k].assetIndexes.length < fewest) {
        fewest = result[k].assetIndexes.length;
        target = k;
      }
    }
    result[target].assetIndexes.push(idx);
  }
  return result;
}

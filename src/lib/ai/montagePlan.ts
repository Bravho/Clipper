import {
  DEFAULT_MOTION_PRESET,
  isMotionPreset,
  MIN_AUTOMATIC_CLIP_PLAYBACK_RATE,
  MONTAGE_FPS,
  type MontageAssetSpec,
  type MotionPreset,
} from "@/config/montage";

/** Shortest on-screen hold for one asset (avoids sub-second flash frames). */
export const MIN_ASSET_HOLD_SECONDS = 0.8;

/**
 * Curated motion rotation for stills. Alternating zoom and pan (rather than
 * `ken_burns_in` on every shot) is what makes the montage read as a reel rather
 * than a slideshow. Indexed by the canonical asset index so neighbouring shots
 * always move differently and the choice is stable across re-renders.
 */
const IMAGE_MOTION_CYCLE: MotionPreset[] = [
  "ken_burns_in",
  "pan_left",
  "ken_burns_out",
  "pan_right",
];

/**
 * Default motion for an asset at a given canonical index. Clips play as-shot
 * (the renderer ignores Ken Burns on clips), so they get `static`; stills cycle
 * through {@link IMAGE_MOTION_CYCLE} for variety. Requester/AI choices made in a
 * panel are honoured upstream and never reach this fallback.
 */
export function pickMotionForIndex(assetIndex: number, kind: "image" | "clip"): MotionPreset {
  if (kind === "clip") return "static";
  const i = Number.isInteger(assetIndex) && assetIndex >= 0 ? assetIndex : 0;
  return IMAGE_MOTION_CYCLE[i % IMAGE_MOTION_CYCLE.length];
}

/**
 * Infer a Ken Burns motion preset from a scene's description (Thai or English)
 * so the rendered camera move HONORS the script's intent — "zoom in"/"ซูมเข้า",
 * "zoom out"/"ถอยห่าง", "pan left/right". Returns null when no move is described,
 * in which case the caller falls back to the per-index variety rotation.
 * Direction-specific pans are checked before generic zoom keywords.
 */
export function inferMotionFromText(text: string | null | undefined): MotionPreset | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => t.includes(k));

  // Directional travel ("left → right" means the camera pans RIGHT) is checked
  // before a bare "pan left/right" so "แพนซ้ายไปขวา" reads as pan_right.
  if (has("ซ้ายไปขวา", "จากซ้ายไปขวา", "left to right", "left-to-right")) return "pan_right";
  if (has("ขวาไปซ้าย", "จากขวาไปซ้าย", "right to left", "right-to-left")) return "pan_left";
  if (has("pan right", "แพนขวา", "ไปทางขวา")) return "pan_right";
  if (has("pan left", "แพนซ้าย", "ไปทางซ้าย")) return "pan_left";

  if (has("zoom out", "zooms out", "zooming out", "pull back", "pull out", "zoom-out", "wide shot", "ซูมออก", "ถอยห่าง", "ถอยออก", "ถอยหลัง", "ดึงออก", "ภาพรวม", "เห็นทั้งร้าน"))
    return "ken_burns_out";
  if (has("zoom in", "zooms in", "zooming in", "push in", "close up", "close-up", "zoom-in", "ซูมเข้า", "เข้าหา", "เข้าใกล้", "ดันเข้า", "ขยับเข้า", "โคลสอัพ"))
    return "ken_burns_in";

  if (has("pan", "แพน", "กวาด")) return "pan_right";
  return null;
}
import type {
  MontageSceneAsset,
  ScenePlan,
  StoryboardScene,
} from "@/domain/models/VideoGenerationJob";
import type { OrderedSourceAsset } from "@/lib/sourceAssets";

/**
 * Pure helpers that turn a Stage-3 `ScenePlan` scene into the concrete,
 * index-aligned montage asset list the Remotion renderer consumes.
 *
 * The cross-pipeline alignment guarantee lives here: every asset is referenced
 * by its index in the canonical ordered source list (`getOrderedSourceAssets`),
 * so index N always resolves to the same uploaded photo/clip in the storyboard,
 * the montage plan, the approval panels, and the renderer. These helpers are
 * free of network/AI deps so they're unit-testable without Remotion or Spaces.
 */

/**
 * Split `totalSeconds` evenly across `count` slots, frame-accurately on the
 * montage's 30 fps grid. Works in whole frames so durations align to real cut
 * points, then spreads any rounding remainder one frame at a time across the
 * earliest slots (largest-remainder) instead of dumping it on the last slot —
 * which previously left an off-beat, lingering final shot.
 *
 * Every slot gets ≥1 frame. When the scene is long enough to afford it
 * (`total >= count * MIN_ASSET_HOLD_SECONDS`), the even split automatically
 * keeps every shot at or above the minimum hold; when there are too many assets
 * for the scene length, shots are evenly short rather than dropping any.
 * Falls back to 1s/asset when the total is non-positive.
 */
export function allocateAssetDurations(count: number, totalSeconds: number): number[] {
  if (count <= 0) return [];

  const fps = MONTAGE_FPS;
  const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : count;
  const totalFrames = Math.max(count, Math.round(total * fps)); // ≥1 frame per slot

  const base = Math.floor(totalFrames / count);
  let remainder = totalFrames - base * count;
  const frames = new Array<number>(count).fill(base);
  for (let i = 0; i < count && remainder > 0; i++, remainder--) frames[i] += 1;

  // Frame-aligned seconds; sum equals totalFrames / fps exactly.
  return frames.map((f) => f / fps);
}

/**
 * Resolve the in-range source indexes a scene draws from, preferring an
 * already-built `assets[]` (montage plan), then `imageIndexes` (legacy/Veo
 * selection), and finally every ordered asset. Out-of-range indexes are
 * dropped; if nothing valid remains, falls back to index 0 (or none when there
 * are no source assets at all), so the renderer always gets ≥1 asset.
 */
function resolveSceneIndexes(scene: ScenePlan, orderedCount: number): number[] {
  const inRange = (i: unknown): i is number =>
    Number.isInteger(i) && (i as number) >= 0 && (i as number) < orderedCount;

  let indexes: number[];
  if (scene.assets && scene.assets.length > 0) {
    indexes = scene.assets.map((a) => a.assetIndex).filter(inRange);
  } else if (scene.imageIndexes && scene.imageIndexes.length > 0) {
    indexes = scene.imageIndexes.filter(inRange);
  } else {
    indexes = Array.from({ length: orderedCount }, (_, i) => i);
  }

  if (indexes.length === 0) return orderedCount > 0 ? [0] : [];
  return indexes;
}

/**
 * Make the requester's approved Stage-1 storyboard authoritative for the
 * concrete scene design. The vision model may improve descriptions and timing,
 * but it must not replace the selected material or scene order.
 *
 * Rebuilding from the storyboard (rather than merely overwriting matching
 * model scenes) also preserves requester-added/removed scenes. `assets` is
 * cleared so `buildSceneMontageAssets` resolves the exact approved indexes.
 */
export function applyApprovedStoryboardSelections(
  generated: ScenePlan[],
  storyboard: StoryboardScene[] | null | undefined
): ScenePlan[] {
  if (!storyboard || storyboard.length === 0) return generated;

  return storyboard.map((approved, index) => {
    const modelScene = generated[index];
    return {
      ...(modelScene ?? {
        sceneNumber: index + 1,
        durationSeconds: approved.roughDurationHint ?? 1,
        visualDescriptionThai: approved.summary,
      }),
      sceneNumber: index + 1,
      visualDescriptionThai:
        modelScene?.visualDescriptionThai ||
        modelScene?.visualDescription ||
        approved.summary,
      imageIndexes: [...approved.assetIndexes],
      assets: undefined,
    };
  });
}

/**
 * Build the concrete `MontageSceneAsset[]` for a scene against the canonical
 * ordered source list. Preserves any per-asset motion/trim/focus already chosen
 * (e.g. by the requester in a panel) and fills the rest with defaults; `kind`
 * is always taken authoritatively from the ordered asset (so a clip is rendered
 * as a clip even if upstream guessed wrong). Durations are distributed across
 * the scene's assets, honoring any positive per-asset duration already set.
 */
export function buildSceneMontageAssets(
  scene: ScenePlan,
  ordered: OrderedSourceAsset[],
  sceneDurationSeconds: number
): MontageSceneAsset[] {
  const indexes = resolveSceneIndexes(scene, ordered.length);
  if (indexes.length === 0) return [];

  // Camera move described in the scene's script (e.g. "zoom out"); applied to
  // the scene's stills so the motion matches the script. Falls back to the
  // per-index variety rotation when nothing is described.
  const sceneMotion = inferMotionFromText(scene.visualDescriptionThai ?? scene.visualDescription);

  // Index existing per-asset choices so panel/AI edits survive a rebuild.
  const existingByIndex = new Map<number, MontageSceneAsset>();
  for (const a of scene.assets ?? []) {
    if (Number.isInteger(a.assetIndex)) existingByIndex.set(a.assetIndex, a);
  }

  // Decide which durations are already pinned vs. need allocation.
  const pinned = indexes.map((i) => {
    const d = existingByIndex.get(i)?.durationSeconds;
    return Number.isFinite(d) && (d as number) > 0 ? (d as number) : null;
  });
  const pinnedTotal = pinned.reduce((sum: number, d) => sum + (d ?? 0), 0);
  const unpinnedCount = pinned.filter((d) => d == null).length;
  const remaining = Math.max(
    unpinnedCount,
    (Number.isFinite(sceneDurationSeconds) && sceneDurationSeconds > 0
      ? sceneDurationSeconds
      : indexes.length) - pinnedTotal
  );
  const allocated = allocateAssetDurations(unpinnedCount, remaining);

  let allocCursor = 0;
  return indexes.map((assetIndex, i) => {
    const src = ordered[assetIndex];
    const existing = existingByIndex.get(assetIndex);
    const durationSeconds = pinned[i] ?? allocated[allocCursor++] ?? 1;
    // Priority: an explicit panel/AI choice → the script's described move (stills
    // only) → the per-index variety rotation.
    const inferred = src.kind === "image" ? sceneMotion : null;
    const motion = isMotionPreset(existing?.motion)
      ? existing!.motion
      : inferred ?? pickMotionForIndex(assetIndex, src.kind);

    const asset: MontageSceneAsset = {
      assetIndex,
      kind: src.kind,
      motion,
      durationSeconds,
    };

    if (src.kind === "clip") {
      if (Number.isFinite(existing?.trimStartSeconds)) {
        asset.trimStartSeconds = Math.max(0, existing!.trimStartSeconds!);
      }
      if (
        Number.isFinite(existing?.trimEndSeconds) &&
        (asset.trimStartSeconds == null || existing!.trimEndSeconds! > asset.trimStartSeconds)
      ) {
        asset.trimEndSeconds = Math.max(0, existing!.trimEndSeconds!);
      }
    }
    if (Number.isFinite(existing?.focusX)) asset.focusX = existing!.focusX;
    if (Number.isFinite(existing?.focusY)) asset.focusY = existing!.focusY;

    return asset;
  });
}

/**
 * Fit a concrete montage plan to the required total without scheduling a clip
 * beyond the footage it can cover at an acceptable playback rate. Extra time
 * goes to stills first. A clip-only plan with insufficient footage is rejected
 * instead of rendering a black remainder.
 */
export function fitScenePlanToVisualCapacity(
  scenePlan: ScenePlan[],
  ordered: OrderedSourceAsset[],
  requiredTotalSeconds: number
): ScenePlan[] {
  const plan = scenePlan.map((scene) => ({
    ...scene,
    assets: scene.assets?.map((asset) => ({ ...asset })),
  }));
  const images: MontageSceneAsset[] = [];
  const clips: Array<{ asset: MontageSceneAsset; capacity: number }> = [];

  for (const scene of plan) {
    for (const asset of scene.assets ?? []) {
      if (asset.kind === "image") {
        images.push(asset);
        continue;
      }
      const selectedSeconds =
        Number.isFinite(asset.trimStartSeconds) &&
        Number.isFinite(asset.trimEndSeconds) &&
        (asset.trimEndSeconds as number) > (asset.trimStartSeconds as number)
          ? (asset.trimEndSeconds as number) - (asset.trimStartSeconds as number)
          : Number(ordered[asset.assetIndex]?.durationSeconds);
      if (!Number.isFinite(selectedSeconds) || selectedSeconds <= 0) continue;
      const capacity = selectedSeconds / MIN_AUTOMATIC_CLIP_PLAYBACK_RATE;
      asset.durationSeconds = Math.min(asset.durationSeconds, capacity);
      clips.push({ asset, capacity });
    }
  }

  const total = () =>
    plan.reduce(
      (sceneSum, scene) =>
        sceneSum +
        (scene.assets ?? []).reduce(
          (assetSum, asset) => assetSum + (Number(asset.durationSeconds) || 0),
          0
        ),
      0
    );
  let remaining = Math.max(0, requiredTotalSeconds - total());

  if (remaining > 0 && images.length > 0) {
    const each = remaining / images.length;
    for (const image of images) image.durationSeconds += each;
    remaining = 0;
  }

  for (const clip of clips) {
    if (remaining <= 1e-6) break;
    const available = Math.max(0, clip.capacity - clip.asset.durationSeconds);
    const added = Math.min(available, remaining);
    clip.asset.durationSeconds += added;
    remaining -= added;
  }

  if (remaining > 1e-6) {
    throw new Error(
      `Uploaded clips cannot cover the voiceover without black frames. Shorten the voice by at least ${Math.ceil(remaining)} seconds or add a still image.`
    );
  }

  return plan.map((scene) => ({
    ...scene,
    durationSeconds: (scene.assets ?? []).reduce(
      (sum, asset) => sum + (Number(asset.durationSeconds) || 0),
      0
    ),
  }));
}

/**
 * Resolve a scene's `MontageSceneAsset[]` (index references) into the renderer's
 * `MontageAssetSpec[]` (concrete URLs). Drops assets whose index falls outside
 * the ordered list; if everything is dropped but the scene had source media,
 * falls back to the first ordered asset so a segment can still render.
 */
export function toRenderAssetSpecs(
  assets: MontageSceneAsset[],
  ordered: OrderedSourceAsset[]
): MontageAssetSpec[] {
  const specs: MontageAssetSpec[] = [];
  for (const a of assets) {
    const src = ordered[a.assetIndex];
    if (!src) continue;
    const spec: MontageAssetSpec = {
      url: src.url,
      kind: src.kind, // authoritative
      motion: isMotionPreset(a.motion) ? a.motion : DEFAULT_MOTION_PRESET,
      durationSeconds:
        Number.isFinite(a.durationSeconds) && a.durationSeconds > 0 ? a.durationSeconds : 1,
    };
    if (src.kind === "clip") {
      if (Number.isFinite(a.trimStartSeconds)) spec.trimStartSeconds = a.trimStartSeconds;
      if (Number.isFinite(a.trimEndSeconds)) spec.trimEndSeconds = a.trimEndSeconds;
    }
    if (Number.isFinite(a.focusX)) spec.focusX = a.focusX;
    if (Number.isFinite(a.focusY)) spec.focusY = a.focusY;
    specs.push(spec);
  }

  if (specs.length === 0 && ordered.length > 0) {
    const src = ordered[0];
    specs.push({
      url: src.url,
      kind: src.kind,
      motion: DEFAULT_MOTION_PRESET,
      durationSeconds: 1,
    });
  }
  return specs;
}

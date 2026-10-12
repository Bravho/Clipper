import type { ScenePlan } from "@/domain/models/VideoGenerationJob";
import { readShapeFraming, readShotFocusBoxes, type ShapeFraming } from "@/lib/mobile/shotFraming";

/**
 * Put the studio's per-shape framing into an approved scene plan.
 *
 * Sent when the person starts the extra channel shapes: by then the AI has
 * looked at every shot's own frames and the person may have fixed a shot in a
 * shape, so this — not the framing worked out at approval — is what those
 * shapes are rendered with. It also repairs plans approved before per-shape
 * framing existed.
 *
 * Only framing moves: durations, trims, order and the main shape's framing are
 * the approved edit and are never touched. A shot is matched to the studio's
 * by position AND asset index; a shot the studio cannot vouch for keeps what
 * it had.
 */

const RATIOS = ["9:16", "16:9", "1:1", "4:5"] as const;
const MAX_MANUAL_JSON = 2_000;

interface IncomingAsset {
  assetIndex: number;
  framings: Partial<Record<string, ShapeFraming>>;
  aiFraming?: unknown;
  shapeFraming?: unknown;
}

function readIncoming(raw: unknown): IncomingAsset[][] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((scene) => {
    const assets = Array.isArray((scene as { assets?: unknown })?.assets)
      ? ((scene as { assets: unknown[] }).assets)
      : [];
    return assets.map((asset) => {
      const entry = (asset ?? {}) as Record<string, unknown>;
      const framings: Partial<Record<string, ShapeFraming>> = {};
      const rawFramings = entry.framings as Record<string, unknown> | undefined;
      if (rawFramings && typeof rawFramings === "object") {
        for (const ratio of RATIOS) {
          const framing = readShapeFraming(rawFramings[ratio]);
          if (framing) framings[ratio] = framing;
        }
      }
      const boxes = readShotFocusBoxes(entry.aiFraming);
      const manual =
        entry.shapeFraming &&
        typeof entry.shapeFraming === "object" &&
        JSON.stringify(entry.shapeFraming).length <= MAX_MANUAL_JSON
          ? entry.shapeFraming
          : undefined;
      return {
        assetIndex: Number(entry.assetIndex),
        framings,
        ...(boxes ? { aiFraming: boxes } : {}),
        ...(manual ? { shapeFraming: manual } : {}),
      };
    });
  });
}

export function mergeShapeFramings(
  plan: ScenePlan[],
  raw: unknown
): { plan: ScenePlan[]; changed: number } {
  const incoming = readIncoming(raw);
  if (!incoming) return { plan, changed: 0 };

  const flatPlan = plan.flatMap((scene) => scene.assets ?? []);
  const flatIncoming = incoming.flat();
  const sameSequence =
    flatPlan.length === flatIncoming.length &&
    flatPlan.every((asset, index) => asset.assetIndex === flatIncoming[index].assetIndex);

  let changed = 0;
  let cursor = 0;
  const merged = plan.map((scene, sceneIndex) => {
    if (!Array.isArray(scene.assets)) return scene;
    return {
      ...scene,
      assets: scene.assets.map((asset, slot) => {
        const match = sameSequence ? flatIncoming[cursor++] : incoming[sceneIndex]?.[slot];
        if (!match || match.assetIndex !== asset.assetIndex) return asset;
        if (Object.keys(match.framings).length === 0) return asset;
        changed += 1;
        return {
          ...asset,
          framings: match.framings,
          ...(match.aiFraming ? { aiFraming: match.aiFraming } : {}),
          ...(match.shapeFraming ? { shapeFraming: match.shapeFraming } : {}),
        };
      }),
    };
  });
  return { plan: merged, changed };
}

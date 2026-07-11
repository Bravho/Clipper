import type { StoryboardScene } from "@/domain/models/VideoGenerationJob";
import {
  estimateSceneDurationRange,
  estimateStoryboardTotalRange,
  type DurationRange,
} from "@/config/montage";

/** "3-5 วินาที" (or "5 วินาที" when the bounds match). Empty range → null. */
function formatRange(range: DurationRange): string | null {
  if (!range || range.maxSeconds <= 0) return null;
  const label =
    range.minSeconds === range.maxSeconds
      ? `${range.maxSeconds}`
      : `${range.minSeconds}-${range.maxSeconds}`;
  return `≈ ${label} วินาที`;
}

/**
 * Read-only storyboard view. Renders each rough scene with its one-line summary
 * and the thumbnails of the photos/clips it draws from, resolved through the
 * canonical asset ordering (so an index here is the same asset everywhere).
 *
 * Pure presentational component (no hooks) — usable from both server and client
 * components. Editing is handled by future panel controls; this is display only.
 */

export interface StoryboardAssetThumb {
  index: number;
  thumbnailUrl: string;
  kind: "image" | "clip";
  fileName: string;
  /** Real clip length (seconds) probed at upload; null for images / unknown. */
  durationSeconds?: number | null;
}

interface StoryboardViewProps {
  scenes: StoryboardScene[];
  assets: StoryboardAssetThumb[];
  title?: string;
  subtitle?: string;
}

export function StoryboardView({ scenes, assets, title, subtitle }: StoryboardViewProps) {
  if (!scenes || scenes.length === 0) return null;
  const byIndex = new Map(assets.map((a) => [a.index, a]));

  // Resolve each scene's asset indexes to their thumbnails (which carry kind +
  // real clip length) so clips are estimated by their true length, images by the
  // flat 3–5s hold.
  const sceneAssetsOf = (scene: StoryboardScene) =>
    (scene.assetIndexes ?? []).map((idx) => byIndex.get(idx));

  const totalRange = estimateStoryboardTotalRange(scenes.map(sceneAssetsOf));
  const totalLabel = formatRange(totalRange);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {title ?? "สตอรีบอร์ด (ภาพรวมฉาก)"}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {totalLabel && (
          <div className="text-right">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              ความยาววิดีโอโดยประมาณ
            </p>
            <p className="text-sm font-semibold tabular-nums text-slate-700">{totalLabel}</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {scenes.map((scene) => {
          const sceneLabel = formatRange(
            estimateSceneDurationRange(sceneAssetsOf(scene))
          );
          return (
          <div
            key={scene.sceneNumber}
            className="rounded-lg border border-slate-100 bg-slate-50 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                ฉาก {scene.sceneNumber}
              </span>
              {sceneLabel && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500">
                  {sceneLabel}
                </span>
              )}
            </div>

            {scene.summary && (
              <p className="mb-2 whitespace-pre-wrap text-sm text-slate-700">{scene.summary}</p>
            )}

            {scene.assetIndexes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {scene.assetIndexes.map((idx) => {
                  const asset = byIndex.get(idx);
                  if (!asset?.thumbnailUrl) {
                    return (
                      <div
                        key={idx}
                        className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-xs text-slate-400"
                      >
                        #{idx + 1}
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.fileName}
                        className="h-16 w-16 rounded-md border border-slate-200 object-cover"
                      />
                      {asset.kind === "clip" && (
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                          คลิป
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

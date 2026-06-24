import type { StoryboardScene } from "@/domain/models/VideoGenerationJob";

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

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title ?? "สตอรีบอร์ด (ภาพรวมฉาก)"}
      </h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}

      <div className="mt-3 flex flex-col gap-3">
        {scenes.map((scene) => (
          <div
            key={scene.sceneNumber}
            className="rounded-lg border border-slate-100 bg-slate-50 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                ฉาก {scene.sceneNumber}
              </span>
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
        ))}
      </div>
    </div>
  );
}

"use client";

import type { MontageSceneAsset } from "@/domain/models/VideoGenerationJob";
import type { OrderedSourceAsset } from "@/lib/sourceAssets";
import { MOTION_PRESETS, type MotionPreset } from "@/config/montage";

/**
 * Shared montage scene-asset editor (Phase 3 UI).
 *
 * Lets the requester choose which of their uploaded photos/clips a scene draws
 * from (in order), pick a Ken-Burns motion preset per asset, and set trim for
 * clips — writing the canonical `MontageSceneAsset[]` the montage renderer
 * consumes. Every asset is referenced by its index in the canonical ordered
 * source list (`OrderedSourceAsset.index`), so the same index resolves to the
 * same media in the storyboard, the scene plan, and the renderer.
 *
 * Per-asset durations are auto-distributed across the scene's selected assets
 * from `sceneDurationSeconds` (the scene-level duration stays the source of
 * truth), so selecting/removing media keeps the scene length intact.
 */

const MOTION_LABELS: Record<MotionPreset, string> = {
  ken_burns_in: "ซูมเข้า",
  ken_burns_out: "ซูมออก",
  pan_left: "แพนซ้าย",
  pan_right: "แพนขวา",
  static: "นิ่ง",
};

interface MontageSceneAssetsEditorProps {
  orderedAssets: OrderedSourceAsset[];
  assets: MontageSceneAsset[];
  sceneDurationSeconds: number;
  onChange: (assets: MontageSceneAsset[]) => void;
}

/** Even-split duration allocation, remainder on the last asset; min 1s each. */
function allocateDurations(count: number, totalSeconds: number): number[] {
  if (count <= 0) return [];
  const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : count;
  const per = Math.max(1, Math.floor(total / count));
  const arr = new Array<number>(count).fill(per);
  const remainder = total - per * count;
  if (remainder > 0) arr[count - 1] = per + remainder;
  return arr;
}

export function MontageSceneAssetsEditor({
  orderedAssets,
  assets,
  sceneDurationSeconds,
  onChange,
}: MontageSceneAssetsEditorProps) {
  const selectedIndexes = assets.map((a) => a.assetIndex);

  /** Re-distribute scene duration across the current asset list and emit. */
  const emit = (next: MontageSceneAsset[]) => {
    const durations = allocateDurations(next.length, sceneDurationSeconds);
    onChange(next.map((a, i) => ({ ...a, durationSeconds: durations[i] ?? 1 })));
  };

  const toggleAsset = (src: OrderedSourceAsset) => {
    const exists = selectedIndexes.includes(src.index);
    if (exists) {
      emit(assets.filter((a) => a.assetIndex !== src.index));
    } else {
      emit([
        ...assets,
        { assetIndex: src.index, kind: src.kind, motion: "ken_burns_in", durationSeconds: 0 },
      ]);
    }
  };

  const updateAsset = (assetIndex: number, patch: Partial<MontageSceneAsset>) => {
    onChange(
      assets.map((a) => (a.assetIndex === assetIndex ? { ...a, ...patch } : a))
    );
  };

  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= assets.length) return;
    const next = [...assets];
    [next[from], next[to]] = [next[to], next[from]];
    emit(next);
  };

  if (orderedAssets.length === 0) {
    return (
      <p className="mt-3 text-xs text-slate-400">ยังไม่มีไฟล์ต้นฉบับสำหรับฉากนี้</p>
    );
  }

  return (
    <div className="mt-3">
      {/* Media palette: tap to add/remove from this scene */}
      <p className="mb-2 text-xs font-medium text-slate-500">
        เลือกรูปและคลิปสำหรับฉากนี้ (แตะเพื่อเพิ่ม/นำออก)
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {orderedAssets.map((src) => {
          const order = selectedIndexes.indexOf(src.index);
          const selected = order >= 0;
          return (
            <button
              type="button"
              key={src.id}
              onClick={() => toggleAsset(src)}
              className={`relative overflow-hidden rounded-md border text-left transition ${
                selected
                  ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                  : "border-slate-200 bg-white hover:border-blue-200"
              }`}
            >
              <div className="aspect-video bg-slate-100">
                {src.thumbnailUrl ? (
                  <img src={src.thumbnailUrl} alt={src.fileName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-medium text-slate-400">
                    {src.kind === "clip" ? "CLIP" : "IMG"}
                  </div>
                )}
              </div>
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">
                {src.kind === "clip" ? "คลิป" : "รูป"}
              </span>
              {selected && (
                <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                  {order + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Ordered selection with per-asset motion + clip trim */}
      {assets.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {assets.map((asset, i) => {
            const src = orderedAssets[asset.assetIndex];
            if (!src) return null;
            return (
              <div
                key={`${asset.assetIndex}-${i}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2"
              >
                <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded bg-slate-100">
                  {src.thumbnailUrl ? (
                    <img src={src.thumbnailUrl} alt={src.fileName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                      {src.kind === "clip" ? "CLIP" : "IMG"}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-600">
                    {i + 1}. {src.kind === "clip" ? "คลิป" : "รูป"} · {asset.durationSeconds} วินาที
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] text-slate-500">การเคลื่อนไหว</label>
                    <select
                      value={asset.motion}
                      onChange={(e) => updateAsset(asset.assetIndex, { motion: e.target.value as MotionPreset })}
                      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700"
                    >
                      {MOTION_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {MOTION_LABELS[preset]}
                        </option>
                      ))}
                    </select>

                    {src.kind === "clip" && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        ตัดคลิป
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={asset.trimStartSeconds ?? ""}
                          placeholder="เริ่ม"
                          onChange={(e) =>
                            updateAsset(asset.assetIndex, {
                              trimStartSeconds: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
                        />
                        –
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={asset.trimEndSeconds ?? ""}
                          placeholder="จบ"
                          onChange={(e) =>
                            updateAsset(asset.assetIndex, {
                              trimEndSeconds: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
                        />
                        วิ
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="rounded border border-slate-200 px-1.5 text-xs text-slate-500 disabled:opacity-30"
                    aria-label="ย้ายขึ้น"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === assets.length - 1}
                    className="rounded border border-slate-200 px-1.5 text-xs text-slate-500 disabled:opacity-30"
                    aria-label="ย้ายลง"
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAsset(src)}
                  className="flex-shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                  aria-label="นำออก"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-amber-600">ยังไม่ได้เลือกสื่อสำหรับฉากนี้</p>
      )}
    </div>
  );
}

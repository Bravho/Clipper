"use client";

import type { StoryboardScene } from "@/domain/models/VideoGenerationJob";
import type { StoryboardAssetThumb } from "@/features/requests/components/StoryboardView";

/**
 * Editable Stage-1 storyboard. Controlled component: the parent owns the
 * `scenes` state and receives every change via `onChange` (scenes are always
 * renumbered contiguously). The requester can edit each scene's summary, toggle
 * which uploaded photos/clips belong to it, reorder scenes, and add/remove
 * scenes. Asset indexes are the canonical `getOrderedSourceAssets` indexes.
 */
interface StoryboardEditorProps {
  scenes: StoryboardScene[];
  assets: StoryboardAssetThumb[];
  onChange: (scenes: StoryboardScene[]) => void;
}

export function StoryboardEditor({ scenes, assets, onChange }: StoryboardEditorProps) {
  const commit = (next: StoryboardScene[]) =>
    onChange(next.map((s, i) => ({ ...s, sceneNumber: i + 1 })));

  const setSummary = (i: number, summary: string) =>
    commit(scenes.map((s, idx) => (idx === i ? { ...s, summary } : s)));

  const toggleAsset = (i: number, assetIndex: number) =>
    commit(
      scenes.map((s, idx) => {
        if (idx !== i) return s;
        const has = s.assetIndexes.includes(assetIndex);
        return {
          ...s,
          assetIndexes: has
            ? s.assetIndexes.filter((x) => x !== assetIndex)
            : [...s.assetIndexes, assetIndex],
        };
      })
    );

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= scenes.length) return;
    const next = [...scenes];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const remove = (i: number) => commit(scenes.filter((_, idx) => idx !== i));
  const add = () =>
    commit([...scenes, { sceneNumber: scenes.length + 1, summary: "", assetIndexes: [] }]);

  const btn =
    "rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        สตอรีบอร์ด (แก้ไขได้)
      </h3>
      <p className="mt-0.5 text-xs text-slate-400">
        จัดลำดับฉากและเลือกรูปภาพ/คลิปที่จะใช้ในแต่ละฉาก — อนุมัติพร้อมบทพูด
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {scenes.map((scene, i) => (
          <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                ฉาก {i + 1}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" className={btn} onClick={() => move(i, -1)} disabled={i === 0} aria-label="ย้ายขึ้น">
                  ↑
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => move(i, 1)}
                  disabled={i === scenes.length - 1}
                  aria-label="ย้ายลง"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                  onClick={() => remove(i)}
                  disabled={scenes.length <= 1}
                  aria-label="ลบฉาก"
                >
                  ลบ
                </button>
              </div>
            </div>

            <textarea
              value={scene.summary}
              onChange={(e) => setSummary(i, e.target.value)}
              rows={2}
              placeholder="สรุปฉากสั้นๆ"
              className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />

            {assets.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {assets.map((asset) => {
                  const selected = scene.assetIndexes.includes(asset.index);
                  return (
                    <button
                      type="button"
                      key={asset.index}
                      onClick={() => toggleAsset(i, asset.index)}
                      className={`relative overflow-hidden rounded-md border transition ${
                        selected
                          ? "border-blue-500 ring-2 ring-blue-100"
                          : "border-slate-200 hover:border-blue-200"
                      }`}
                    >
                      <div className="aspect-square bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={asset.thumbnailUrl} alt={asset.fileName} className="h-full w-full object-cover" />
                      </div>
                      {asset.kind === "clip" && (
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                          คลิป
                        </span>
                      )}
                      {selected && (
                        <span className="absolute left-0.5 top-0.5 rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-3 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-blue-300 hover:text-blue-600"
      >
        + เพิ่มฉาก
      </button>
    </div>
  );
}

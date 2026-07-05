"use client";

import type { MontageSceneAsset } from "@/domain/models/VideoGenerationJob";
import type { OrderedSourceAsset } from "@/lib/sourceAssets";
import { MOTION_PRESETS, type MotionPreset, assetPlaySeconds } from "@/config/montage";
import { ClipTrimBar } from "@/features/requests/components/ClipTrimBar";

/**
 * Shared montage scene-asset editor.
 *
 * Lets the requester choose which of their uploaded photos/clips a scene draws
 * from (in order), pick a Ken-Burns motion preset per asset, and — for clips —
 * set the in/out points on a playable, draggable {@link ClipTrimBar}. Every
 * asset is referenced by its index in the canonical ordered source list
 * (`OrderedSourceAsset.index`), so the same index resolves to the same media in
 * the storyboard, the scene plan, and the renderer.
 *
 * Duration model: a trimmed CLIP's on-screen play time is its selected window
 * (out − in); stills keep their allocated duration. The scene total is the sum
 * of per-asset durations and AUTO-GROWS as clips are trimmed longer — the
 * editor never redistributes existing durations, so dragging one clip never
 * silently changes another asset's length.
 */

const MOTION_LABELS: Record<MotionPreset, string> = {
  ken_burns_in: "ซูมเข้า",
  ken_burns_out: "ซูมออก",
  pan_left: "แพนซ้าย",
  pan_right: "แพนขวา",
  static: "นิ่ง",
};

const VIDEO_URL_RE = /\.(mp4|mov|webm|avi|m4v)(?:[?#]|$)/i;

/**
 * Thumbnail for one source asset. Always renders as a lightweight <img> using
 * the generated poster (images and clips both get a poster JPEG at upload).
 * For a clip uploaded before poster generation — whose `thumbnailUrl` falls
 * back to the raw .mp4 — it shows a static "คลิป" placeholder rather than a live
 * <video>: many concurrent <video> elements exhaust the browser's video
 * decoders and stall the scene's ClipTrimBar preview. (Run the poster backfill
 * to replace the placeholder with a real frame.)
 */
function AssetThumb({ src }: { src: OrderedSourceAsset }) {
  const hasPoster = !!src.thumbnailUrl && !VIDEO_URL_RE.test(src.thumbnailUrl);
  if (hasPoster) {
    return <img src={src.thumbnailUrl} alt={src.fileName} className="h-full w-full object-cover" />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[10px] font-medium text-slate-400">
      {src.kind === "clip" ? "คลิป" : "รูป"}
    </div>
  );
}

interface MontageSceneAssetsEditorProps {
  orderedAssets: OrderedSourceAsset[];
  assets: MontageSceneAsset[];
  sceneDurationSeconds: number;
  onChange: (assets: MontageSceneAsset[]) => void;
}

/** Sensible default on-screen seconds for a newly added asset (even share of
 *  the scene's current baseline; min 1s). Only applied to the new asset — never
 *  to existing ones — so it can't disturb durations already set. */
function defaultAssetDuration(count: number, baseline: number): number {
  const total = Number.isFinite(baseline) && baseline > 0 ? baseline : count;
  return Math.max(1, Math.round(total / Math.max(1, count)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function MontageSceneAssetsEditor({
  orderedAssets,
  assets,
  sceneDurationSeconds,
  onChange,
}: MontageSceneAssetsEditorProps) {
  const selectedIndexes = assets.map((a) => a.assetIndex);

  const toggleAsset = (src: OrderedSourceAsset) => {
    const exists = selectedIndexes.includes(src.index);
    if (exists) {
      // Removing an asset leaves the others' durations untouched.
      onChange(assets.filter((a) => a.assetIndex !== src.index));
    } else {
      onChange([
        ...assets,
        {
          assetIndex: src.index,
          kind: src.kind,
          motion: "ken_burns_in",
          durationSeconds: defaultAssetDuration(assets.length + 1, sceneDurationSeconds),
        },
      ]);
    }
  };

  const updateAsset = (assetIndex: number, patch: Partial<MontageSceneAsset>) => {
    onChange(assets.map((a) => (a.assetIndex === assetIndex ? { ...a, ...patch } : a)));
  };

  /** A clip's trim window IS its on-screen play time, so update both together. */
  const handleTrimChange = (assetIndex: number, trim: { start: number; end: number }) => {
    const durationSeconds = Math.max(0.1, round2(trim.end - trim.start));
    updateAsset(assetIndex, {
      trimStartSeconds: round2(trim.start),
      trimEndSeconds: round2(trim.end),
      durationSeconds,
    });
  };

  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= assets.length) return;
    const next = [...assets];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  if (orderedAssets.length === 0) {
    return <p className="mt-3 text-xs text-slate-400">ยังไม่มีไฟล์ต้นฉบับสำหรับฉากนี้</p>;
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
                <AssetThumb src={src} />
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

      {/* Ordered selection with per-asset motion + clip trim bar */}
      {assets.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {assets.map((asset, i) => {
            const src = orderedAssets[asset.assetIndex];
            if (!src) return null;
            const isClip = src.kind === "clip";
            return (
              <div
                key={`${asset.assetIndex}-${i}`}
                className="rounded-lg border border-slate-200 bg-white p-2"
              >
                <div className="flex items-center gap-3">
                  <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded bg-slate-100">
                    <AssetThumb src={src} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-600">
                      {i + 1}. {isClip ? "คลิป" : "รูป"} · {round2(assetPlaySeconds(asset))} วินาที
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <label className="text-[11px] text-slate-500">การเคลื่อนไหว</label>
                      <select
                        value={asset.motion}
                        onChange={(e) =>
                          updateAsset(asset.assetIndex, { motion: e.target.value as MotionPreset })
                        }
                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700"
                        disabled={isClip}
                        title={isClip ? "คลิปจะเล่นตามที่ถ่ายมา" : undefined}
                      >
                        {MOTION_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {MOTION_LABELS[preset]}
                          </option>
                        ))}
                      </select>
                      {isClip && (
                        <span className="text-[11px] text-slate-400">ลากที่แถบด้านล่างเพื่อตัดคลิป</span>
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

                {isClip && (
                  <ClipTrimBar
                    url={src.url}
                    trimStartSeconds={asset.trimStartSeconds}
                    trimEndSeconds={asset.trimEndSeconds}
                    playSeconds={asset.durationSeconds}
                    onChange={(trim) => handleTrimChange(asset.assetIndex, trim)}
                  />
                )}
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

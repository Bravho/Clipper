"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import { AssetType } from "@/domain/enums/AssetType";

interface SceneScriptApprovalPanelProps {
  requestId: string;
  jobId: string;
  /** Full approved scene plan (all scenes). */
  initialScenes: ScenePlan[];
  scriptThai: string | null;
  hookThai: string | null;
  captionThai: string | null;
  /** 0-based index of the scene currently awaiting its script gate. */
  activeSceneIndex: number;
  voiceRecordingUrl: string | null;
  voiceRecordingAssetId: string | null;
  /** Latest generated (and previously approved) cumulative video, shown for context. */
  latestVideoUrl: string | null;
  latestVideoAssetId: string | null;
  sourceAssets: UploadedAsset[];
}

const ta =
  "w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300";

function getSceneImages(scene: ScenePlan): number[] {
  return Array.isArray(scene.imageIndexes) ? scene.imageIndexes.slice(0, 2) : [];
}

export function SceneScriptApprovalPanel({
  requestId,
  jobId,
  initialScenes,
  scriptThai,
  hookThai,
  captionThai,
  activeSceneIndex,
  voiceRecordingUrl,
  voiceRecordingAssetId,
  latestVideoUrl,
  latestVideoAssetId,
  sourceAssets,
}: SceneScriptApprovalPanelProps) {
  const router = useRouter();
  const [scenes, setScenes] = useState<ScenePlan[]>(initialScenes);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeIndex = Math.min(Math.max(activeSceneIndex, 0), Math.max(scenes.length - 1, 0));
  const activeScene = scenes[safeIndex];

  const sourceImageOptions = sourceAssets
    .map((asset, sourceIndex) => ({ asset, sourceIndex }))
    .filter(({ asset }) => asset.assetType === AssetType.Image);

  const updateScene = (index: number, patch: Partial<ScenePlan>) => {
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  };

  const toggleSceneImage = (sceneIndex: number, sourceIndex: number) => {
    setScenes((prev) =>
      prev.map((scene, index) => {
        if (index !== sceneIndex) return scene;
        const current = getSceneImages(scene);
        const imageIndexes = current.includes(sourceIndex)
          ? current.filter((i) => i !== sourceIndex)
          : current.length >= 2
            ? current
            : [...current, sourceIndex];
        return {
          ...scene,
          imageIndexes,
          durationSeconds: imageIndexes.length === 2 ? 8 : scene.durationSeconds,
        };
      })
    );
  };

  const handleApprove = async () => {
    setIsApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/scene-script/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, scenePlan: scenes, hookThai, scriptThai, captionThai }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถอนุมัติสคริปต์ฉากนี้ได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsApproving(false);
    }
  };

  if (!activeScene) return null;

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm font-semibold text-purple-800">
          สคริปต์ฉากที่ {safeIndex + 1} จาก {scenes.length} พร้อมให้ตรวจสอบ
        </p>
        <p className="mt-0.5 text-sm text-purple-700">
          ตรวจสอบและแก้ไขสคริปต์และภาพประกอบของฉากนี้ ก่อนเริ่มสร้างวิดีโอฉากนี้
          {safeIndex > 0 ? " (ต่อเนื่องจากฉากก่อนหน้าที่อนุมัติแล้ว)" : ""}
        </p>
      </div>

      {latestVideoUrl && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            วิดีโอล่าสุดที่สร้างแล้ว (ฉากก่อนหน้า)
          </h3>
          <video
            key={latestVideoAssetId ?? latestVideoUrl}
            src={`${latestVideoUrl}${latestVideoUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(latestVideoAssetId ?? latestVideoUrl)}`}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-lg bg-black"
            style={{ maxHeight: 480 }}
          />
        </div>
      )}

      {scriptThai && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            บทพูดที่ใช้เป็นฐานในการออกแบบ
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{scriptThai}</p>
        </div>
      )}

      {voiceRecordingUrl && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            เสียงพากย์ที่อนุมัติ
          </p>
          <audio
            key={voiceRecordingAssetId ?? voiceRecordingUrl}
            src={`${voiceRecordingUrl}${voiceRecordingUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(voiceRecordingAssetId ?? voiceRecordingUrl)}`}
            controls
            preload="metadata"
            className="w-full"
          />
        </div>
      )}

      {/* Per-scene gate: show only the current scene being approved. */}
      <div className="rounded-xl border border-purple-300 bg-purple-50/40 p-5 ring-1 ring-purple-200">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">
            Scene {safeIndex + 1} of {scenes.length} - {activeScene.durationSeconds} seconds
          </span>
          <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            อนุมัติฉากนี้
          </span>
        </div>
        <textarea
          value={activeScene.visualDescriptionThai ?? ""}
          onChange={(e) => updateScene(safeIndex, { visualDescriptionThai: e.target.value })}
          rows={3}
          className={`${ta} text-sm text-slate-700`}
        />

        {sourceImageOptions.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-slate-500">
              Uploaded images for this scene (max 2)
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {sourceImageOptions.map(({ asset, sourceIndex }) => {
                const selected = getSceneImages(activeScene).includes(sourceIndex);
                const maxSelected = getSceneImages(activeScene).length >= 2 && !selected;
                const thumbSrc = asset.thumbnailUrl || asset.storageUrl;

                return (
                  <button
                    type="button"
                    key={asset.id}
                    disabled={maxSelected}
                    onClick={() => toggleSceneImage(safeIndex, sourceIndex)}
                    className={`overflow-hidden rounded-md border text-left transition ${
                      selected
                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                        : "border-slate-200 bg-white hover:border-blue-200"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <div className="aspect-video bg-slate-100">
                      <img src={thumbSrc} alt={asset.fileName} className="h-full w-full object-cover" />
                    </div>
                    <div className="px-2 py-1">
                      <p className="truncate text-xs text-slate-600">
                        {selected ? "Selected" : "Image"} {sourceIndex + 1}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
            {getSceneImages(activeScene).length === 2 && (
              <p className="mt-1 text-xs text-blue-600">
                Two images selected: scene time is fixed at 8 seconds for morphing.
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex justify-end pb-2">
        <Button onClick={handleApprove} loading={isApproving} disabled={isApproving}>
          อนุมัติสคริปต์ฉากนี้และสร้างวิดีโอ →
        </Button>
      </div>
    </div>
  );
}

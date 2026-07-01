"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { MontageSceneAsset, ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import type { OrderedSourceAsset } from "@/lib/sourceAssets";
import { MontageSceneAssetsEditor } from "@/features/requests/components/MontageSceneAssetsEditor";

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
  /** Latest rendered scene segment, shown for context. */
  latestVideoUrl: string | null;
  latestVideoAssetId: string | null;
  /** Retained for compatibility; the montage editor uses `orderedAssets`. */
  sourceAssets: UploadedAsset[];
  /** Canonical, index-stable source media (images + clips). */
  orderedAssets: OrderedSourceAsset[];
}

const ta =
  "w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300";

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
  orderedAssets,
}: SceneScriptApprovalPanelProps) {
  const router = useRouter();
  const [scenes, setScenes] = useState<ScenePlan[]>(initialScenes);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeIndex = Math.min(Math.max(activeSceneIndex, 0), Math.max(scenes.length - 1, 0));
  const activeScene = scenes[safeIndex];

  const updateScene = (index: number, patch: Partial<ScenePlan>) => {
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  };

  /** Persist montage asset edits: keep scene.assets and resize the scene to
   *  the sum of its asset durations. imageIndexes is cleared so the legacy Veo
   *  morph/duration rules stay dormant on the montage path. */
  const updateSceneAssets = (index: number, assets: MontageSceneAsset[]) => {
    const total = assets.reduce((sum, a) => sum + (Number(a.durationSeconds) || 0), 0);
    updateScene(index, {
      assets,
      imageIndexes: [],
      ...(total > 0 ? { durationSeconds: total } : {}),
    });
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
            src={voiceRecordingUrl}
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

        <MontageSceneAssetsEditor
          orderedAssets={orderedAssets}
          assets={activeScene.assets ?? []}
          sceneDurationSeconds={activeScene.durationSeconds}
          onChange={(assets) => updateSceneAssets(safeIndex, assets)}
        />
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

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import { AssetType } from "@/domain/enums/AssetType";
import { calcPipelineCost, PIPELINE_STEP_COSTS } from "@/config/credits";

interface SceneDesignApprovalPanelProps {
  requestId: string;
  jobId: string;
  initialScenes: ScenePlan[];
  scriptThai: string | null;
  initialDurationSeconds: number;
  voiceDurationSeconds: number | null;
  voiceRecordingUrl: string | null;
  voiceRecordingAssetId: string | null;
  totalChannels: number;
  sourceAssets: UploadedAsset[];
}

const ta =
  "w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300";

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS;
  return Math.min(
    PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS,
    Math.max(PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS, Math.round(value))
  );
}

function sceneTotal(scenes: ScenePlan[]): number {
  return scenes.reduce((sum, scene) => sum + (Number(scene.durationSeconds) || 0), 0);
}

function scaleScenesToDuration(scenes: ScenePlan[], durationSeconds: number): ScenePlan[] {
  if (scenes.length === 0) return scenes;

  const currentTotal = sceneTotal(scenes);
  if (currentTotal <= 0) {
    const equal = Math.max(1, Math.round(durationSeconds / scenes.length));
    return scenes.map((scene) => ({ ...scene, durationSeconds: equal }));
  }

  let remaining = durationSeconds;
  return scenes.map((scene, index) => {
    if (index === scenes.length - 1) {
      return { ...scene, durationSeconds: Math.max(1, remaining) };
    }

    const nextDuration = Math.max(
      1,
      Math.round(((Number(scene.durationSeconds) || 0) / currentTotal) * durationSeconds)
    );
    remaining -= nextDuration;
    return { ...scene, durationSeconds: nextDuration };
  });
}

export function SceneDesignApprovalPanel({
  requestId,
  jobId,
  initialScenes,
  scriptThai,
  initialDurationSeconds,
  voiceDurationSeconds,
  voiceRecordingUrl,
  voiceRecordingAssetId,
  totalChannels,
  sourceAssets,
}: SceneDesignApprovalPanelProps) {
  const router = useRouter();
  const submittedDuration = clampDuration(initialDurationSeconds);
  const [durationSeconds, setDurationSeconds] = useState(submittedDuration);
  const [scenes, setScenes] = useState<ScenePlan[]>(() =>
    scaleScenesToDuration(initialScenes, submittedDuration)
  );
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSceneSeconds = sceneTotal(scenes);
  const costEstimate = useMemo(
    () => calcPipelineCost(durationSeconds, totalChannels),
    [durationSeconds, totalChannels]
  );

  const updateScene = (index: number, patch: Partial<ScenePlan>) => {
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  };

  const updateDuration = (value: number) => {
    const nextDuration = clampDuration(value);
    setDurationSeconds(nextDuration);
    setScenes((prev) => scaleScenesToDuration(prev, nextDuration));
  };

  const handleApprove = async () => {
    setIsApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/scene-design/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, scenePlan: scenes, durationSeconds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถอนุมัติแผนฉากได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsApproving(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm font-semibold text-purple-800">สคริปต์วิดีโอพร้อมให้ตรวจสอบ</p>
        <p className="mt-0.5 text-sm text-purple-700">
          AI ออกแบบแผนฉากจากบทพูดที่อนุมัติแล้ว โดยอ้างอิงความยาวเสียงพากย์
          {voiceDurationSeconds ? ` ${voiceDurationSeconds.toFixed(1)} วินาที` : ""} ตรวจสอบเวลา ภาพประกอบ และคำอธิบายฉากก่อนเริ่มสร้างวิดีโอ
        </p>
      </div>

      {scriptThai && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            บทพูดที่ใช้เป็นฐานในการออกแบบ
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{scriptThai}</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700">ความยาววิดีโอ</label>
          <span className="rounded-full bg-blue-600 px-3 py-0.5 text-sm font-bold text-white tabular-nums">
            {durationSeconds} วินาที
          </span>
        </div>
        <input
          type="range"
          min={PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS}
          max={PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS}
          step={1}
          value={durationSeconds}
          onChange={(e) => updateDuration(Number(e.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-blue-600"
        />
        <div className="mt-1 flex justify-between text-xs text-slate-400">
          <span>{PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS} วินาที</span>
          <span>{PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS} วินาที</span>
        </div>

        {voiceRecordingUrl && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
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

        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-blue-800">ประมาณการเครดิตตามความยาวนี้</p>
              <p className="mt-0.5 text-xs text-blue-600">
                คำนวณจาก {durationSeconds} วินาที และ {totalChannels} ช่องทางเผยแพร่
              </p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-right">
              <p className="text-lg font-bold text-blue-700 tabular-nums">{costEstimate.total}</p>
              <p className="text-xs text-slate-400">เครดิต</p>
            </div>
          </div>
        </div>
      </div>

      {sourceAssets.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            ไฟล์ต้นฉบับที่อัปโหลด
          </h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {sourceAssets.map((asset) => {
              const thumbSrc = asset.thumbnailUrl || (asset.assetType === AssetType.Image ? asset.storageUrl : "");
              return (
                <li key={asset.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex aspect-square items-center justify-center bg-slate-50">
                    {thumbSrc ? (
                      <img src={thumbSrc} alt={asset.fileName} className="h-full w-full object-cover" />
                    ) : (
                      <div className="text-xs font-medium text-slate-400">VIDEO</div>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-xs text-slate-700">{asset.fileName}</p>
                    <p className="text-xs text-slate-400">
                      {(asset.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            แผนฉาก รวม {totalSceneSeconds} วินาที
          </h3>
          {totalSceneSeconds !== durationSeconds && (
            <span className="text-xs text-amber-600">
              เวลารวมควรเท่ากับ {durationSeconds} วินาที
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {scenes.map((scene, index) => (
            <div key={`${scene.sceneNumber}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">
                  ฉาก {scene.sceneNumber} · {scene.durationSeconds} วินาที
                </span>
                <input
                  type="number"
                  min={1}
                  value={scene.durationSeconds}
                  onChange={(e) => updateScene(index, { durationSeconds: Number(e.target.value) || 1 })}
                  className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                />
                <span className="text-xs text-slate-400">วินาที</span>
              </div>
              <textarea
                value={scene.visualDescriptionThai ?? ""}
                onChange={(e) => updateScene(index, { visualDescriptionThai: e.target.value })}
                rows={3}
                className={`${ta} text-sm text-slate-700`}
              />
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex justify-end pb-2">
        <Button
          onClick={handleApprove}
          loading={isApproving}
          disabled={isApproving || scenes.length === 0 || totalSceneSeconds !== durationSeconds}
        >
          อนุมัติแผนฉากและสร้างวิดีโอ →
        </Button>
      </div>
    </div>
  );
}

export function SceneDesignGeneratingPanel({
  voiceDurationSeconds,
}: {
  voiceDurationSeconds: number | null;
}) {
  return (
    <div className="mb-6 rounded-xl border border-purple-200 bg-white p-6">
      <div className="flex items-start gap-4">
        <div className="relative mt-1 h-12 w-12 flex-shrink-0">
          <div className="absolute inset-0 rounded-full border-4 border-purple-100" />
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-purple-600" />
          <div className="absolute inset-3 rounded-full bg-purple-100" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-slate-900">กำลังสร้างสคริปต์และแผนฉาก</p>
          <p className="mt-1 text-sm text-slate-500">
            AI กำลังออกแบบฉากจากเสียงพากย์ที่อนุมัติ
            {voiceDurationSeconds ? ` (${voiceDurationSeconds.toFixed(1)} วินาที)` : ""} และไฟล์ต้นฉบับที่อัปโหลด
          </p>
          <div className="mt-4 space-y-2">
            <div className="h-2 w-11/12 animate-pulse rounded-full bg-purple-100" />
            <div className="h-2 w-8/12 animate-pulse rounded-full bg-purple-100 [animation-delay:120ms]" />
            <div className="h-2 w-10/12 animate-pulse rounded-full bg-purple-100 [animation-delay:240ms]" />
          </div>
        </div>
      </div>
    </div>
  );
}

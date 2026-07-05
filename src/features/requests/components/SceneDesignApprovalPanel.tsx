"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { MontageSceneAsset, ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import type { OrderedSourceAsset } from "@/lib/sourceAssets";
import { AssetType } from "@/domain/enums/AssetType";
import { calcPipelineCost, PIPELINE_STEP_COSTS } from "@/config/credits";
import { MontageSceneAssetsEditor } from "@/features/requests/components/MontageSceneAssetsEditor";
import { assetPlaySeconds, minMontageTotalSeconds, sceneMontageSeconds } from "@/config/montage";

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
  /** Canonical, index-stable source media (images + clips). */
  orderedAssets: OrderedSourceAsset[];
  activeSceneIndex?: number;
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

/** True total video length = Σ per-asset on-screen seconds (trimmed clips
 *  count their selected window), falling back to scene.durationSeconds. */
function sceneTotal(scenes: ScenePlan[]): number {
  return scenes.reduce((sum, scene) => sum + sceneMontageSeconds(scene), 0);
}

/** A clip whose in/out window is set — its duration is pinned to that window. */
function isTrimmedClip(a: MontageSceneAsset): boolean {
  return (
    a.kind === "clip" &&
    Number.isFinite(a.trimStartSeconds) &&
    Number.isFinite(a.trimEndSeconds) &&
    (a.trimEndSeconds as number) > (a.trimStartSeconds as number)
  );
}

function getInitialSceneImages(scene: ScenePlan): number[] {
  return Array.isArray(scene.imageIndexes) ? scene.imageIndexes.slice(0, 2) : [];
}

function scaleScenesToDuration(scenes: ScenePlan[], durationSeconds: number): ScenePlan[] {
  if (scenes.length === 0) return scenes;

  const fixedDurations: number[] = scenes.map((scene) =>
    getInitialSceneImages(scene).length === 2 ? 8 : 0
  );
  const fixedTotal = fixedDurations.reduce((sum, duration) => sum + duration, 0);
  const flexibleIndexes = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => getInitialSceneImages(scene).length !== 2)
    .map(({ index }) => index);
  const flexibleTarget = Math.max(flexibleIndexes.length, durationSeconds - fixedTotal);

  if (flexibleIndexes.length === 0) {
    return scenes.map((scene) => ({
      ...scene,
      durationSeconds: getInitialSceneImages(scene).length === 2 ? 8 : scene.durationSeconds,
    }));
  }

  const currentTotal = flexibleIndexes.reduce(
    (sum, index) => sum + (Number(scenes[index].durationSeconds) || 0),
    0
  );
  if (currentTotal <= 0) {
    const equal = Math.max(1, Math.round(flexibleTarget / flexibleIndexes.length));
    return scenes.map((scene) => ({
      ...scene,
      durationSeconds: getInitialSceneImages(scene).length === 2 ? 8 : equal,
    }));
  }

  let remaining = flexibleTarget;
  return scenes.map((scene, index) => {
    if (getInitialSceneImages(scene).length === 2) {
      return { ...scene, durationSeconds: 8 };
    }

    if (index === flexibleIndexes[flexibleIndexes.length - 1]) {
      return { ...scene, durationSeconds: Math.max(1, remaining) };
    }

    const nextDuration = Math.max(
      1,
      Math.round(((Number(scene.durationSeconds) || 0) / currentTotal) * flexibleTarget)
    );
    remaining -= nextDuration;
    return { ...scene, durationSeconds: nextDuration };
  });
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

/** Distribute a scene's target duration across its montage assets while
 *  PRESERVING trimmed clips: a clip with an in/out window keeps that window as
 *  its duration; only stills and untrimmed clips share the remaining budget.
 *  If the pinned clips already exceed the target, the scene auto-grows and the
 *  flexible assets fall back to their minimum. */
function reallocateSceneAssets(scene: ScenePlan): ScenePlan {
  if (!scene.assets || scene.assets.length === 0) return scene;

  const pinned = scene.assets.map((a) => (isTrimmedClip(a) ? assetPlaySeconds(a) : null));
  const pinnedTotal = pinned.reduce((sum: number, d) => sum + (d ?? 0), 0);
  const flexCount = pinned.filter((d) => d == null).length;
  const flexBudget = Math.max(flexCount, (Number(scene.durationSeconds) || 0) - pinnedTotal);
  const flexDurations = allocateDurations(flexCount, flexBudget);

  let c = 0;
  const assets = scene.assets.map((a, i) => ({
    ...a,
    durationSeconds: pinned[i] ?? flexDurations[c++] ?? 1,
  }));
  const durationSeconds = assets.reduce((sum, a) => sum + (Number(a.durationSeconds) || 0), 0);
  return { ...scene, assets, durationSeconds };
}

/** On load, montage scenes (those carrying `assets`) drop `imageIndexes` so the
 *  legacy Veo morph/duration rules stay dormant, and get assets resized. */
function normalizeMontageScenes(scenes: ScenePlan[]): ScenePlan[] {
  return scenes.map((scene) =>
    scene.assets && scene.assets.length > 0
      ? reallocateSceneAssets({ ...scene, imageIndexes: [] })
      : scene
  );
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
  orderedAssets,
  activeSceneIndex = 0,
}: SceneDesignApprovalPanelProps) {
  const router = useRouter();
  const submittedDuration = clampDuration(voiceDurationSeconds ?? initialDurationSeconds);
  const [durationSeconds, setDurationSeconds] = useState(submittedDuration);
  // Preserve the server-sized montage durations on load (they already cover the
  // voice + short intro/ending). Only re-split each scene's assets; don't scale
  // the total down to the raw voice length, which would trip the minimum gate.
  const [scenes, setScenes] = useState<ScenePlan[]>(() => normalizeMontageScenes(initialScenes));
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSceneSeconds = sceneTotal(scenes);
  // The montage (stills + trimmed clips) must be long enough to cover the whole
  // voiceover plus the short music intro and ending — otherwise narration would
  // run past the picture. Total may exceed the voice length (auto-grow) freely.
  const minTotalSeconds = minMontageTotalSeconds(voiceDurationSeconds ?? submittedDuration);
  const meetsMinimum = totalSceneSeconds + 1e-6 >= minTotalSeconds;

  const round1 = (n: number) => Math.round(n * 10) / 10;

  // Everything that must be fixed before the plan can be approved, as friendly
  // Thai messages. Shown proactively so the requester knows what to adjust; the
  // approve button stays clickable and re-checks these on click.
  const blockers: string[] = [];
  if (scenes.length === 0) {
    blockers.push("ต้องมีอย่างน้อย 1 ฉาก");
  }
  const emptyScenes = scenes
    .map((s, i) => ({ hasAssets: (s.assets?.length ?? 0) > 0, num: i + 1 }))
    .filter((s) => !s.hasAssets)
    .map((s) => s.num);
  if (emptyScenes.length > 0) {
    blockers.push(`ฉากที่ ${emptyScenes.join(", ")} ยังไม่ได้เลือกรูปหรือคลิป`);
  }
  if (!meetsMinimum) {
    blockers.push(
      `ความยาววิดีโอรวมตอนนี้ ${round1(totalSceneSeconds)} วินาที ต้องอย่างน้อย ${round1(minTotalSeconds)} วินาที เพื่อให้คลุมเสียงพากย์ทั้งหมด — เพิ่มความยาวฉาก หรือเลือกช่วงคลิปให้ยาวขึ้น`
    );
  }
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
    setScenes((prev) => scaleScenesToDuration(prev, nextDuration).map(reallocateSceneAssets));
  };

  /** Edit a montage scene's per-scene duration and redistribute it across its
   *  selected assets so the rendered scene length matches what's shown. */
  const updateSceneDuration = (index: number, seconds: number) => {
    setScenes((prev) =>
      prev.map((scene, i) =>
        i === index ? reallocateSceneAssets({ ...scene, durationSeconds: Math.max(1, seconds) }) : scene
      )
    );
  };

  /** Persist montage asset edits: keep scene.assets, clear imageIndexes so the
   *  legacy Veo morph rules stay dormant, and keep the scene length in sync. */
  const updateSceneAssets = (index: number, assets: MontageSceneAsset[]) => {
    const total = assets.reduce((sum, a) => sum + assetPlaySeconds(a), 0);
    updateScene(index, {
      assets,
      imageIndexes: [],
      ...(total > 0 ? { durationSeconds: total } : {}),
    });
  };

  const handleApprove = async () => {
    if (blockers.length > 0) {
      // Don't call the API — the notice above the button already lists exactly
      // what to adjust (shown proactively whenever there are blockers).
      setError("กรุณาปรับแก้รายการด้านล่างก่อนดำเนินการต่อ");
      return;
    }
    setIsApproving(true);
    setError(null);
    try {
      // Belt-and-suspenders: keep each montage scene's per-asset durations
      // consistent (trimmed clips pinned, stills rebalanced) before the renderer
      // and the server-side minimum check consume them.
      const scenePlan = scenes.map(reallocateSceneAssets);
      const res = await fetch(`/api/requests/${requestId}/scene-design/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, scenePlan, durationSeconds }),
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
              src={voiceRecordingUrl}
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
              const isVideo = asset.assetType === AssetType.Video;
              // Prefer a generated poster; for images use the full image. Clips
              // with no poster (uploaded before poster generation) show a static
              // placeholder — NOT a live <video>, which would compete for the
              // browser's limited video decoders. Run the poster backfill to
              // replace the placeholder with a real frame.
              const imgSrc = asset.thumbnailUrl || (!isVideo ? asset.storageUrl : "");
              return (
                <li key={asset.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex aspect-square items-center justify-center bg-slate-50">
                    {imgSrc ? (
                      <img src={imgSrc} alt={asset.fileName} className="h-full w-full object-cover" />
                    ) : (
                      <div className="text-xs font-medium text-slate-400">{isVideo ? "วิดีโอ" : "ไฟล์"}</div>
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
            แผนฉาก · ความยาววิดีโอรวม {Math.round(totalSceneSeconds * 10) / 10} วินาที
          </h3>
          {!meetsMinimum && (
            <span className="text-xs text-amber-600">
              ต้องยาวอย่างน้อย {Math.round(minTotalSeconds * 10) / 10} วินาที (คลุมเสียงพากย์ทั้งหมด)
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {scenes.map((scene, sceneIndex) => (
            <div
              key={`${scene.sceneNumber}-${sceneIndex}`}
              className={`rounded-lg border p-4 ${
                sceneIndex === 0
                  ? "border-purple-300 bg-purple-50/40 ring-1 ring-purple-200"
                  : "border-slate-100 bg-slate-50"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">
                  Scene {sceneIndex + 1} of {scenes.length} - {scene.durationSeconds} seconds
                </span>
                {sceneIndex === 0 && (
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    อนุมัติฉากนี้ก่อน
                  </span>
                )}
                <input
                  type="number"
                  min={1}
                  value={scene.durationSeconds}
                  onChange={(e) => updateSceneDuration(sceneIndex, Number(e.target.value) || 1)}
                  className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                />
                <span className="text-xs text-slate-400">seconds</span>
              </div>
              <textarea
                value={scene.visualDescriptionThai ?? ""}
                onChange={(e) =>
                  updateScene(sceneIndex, { visualDescriptionThai: e.target.value })
                }
                rows={3}
                className={`${ta} text-sm text-slate-700`}
              />
              <MontageSceneAssetsEditor
                orderedAssets={orderedAssets}
                assets={scene.assets ?? []}
                sceneDurationSeconds={scene.durationSeconds}
                onChange={(assets) => updateSceneAssets(sceneIndex, assets)}
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

      {blockers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            ปรับแก้ก่อนดำเนินการต่อ
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700">
            {blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col items-end gap-1 pb-2">
        <Button onClick={handleApprove} loading={isApproving} disabled={isApproving}>
          อนุมัติแผนฉากและสร้างวิดีโอ →
        </Button>
        {blockers.length > 0 && (
          <p className="text-xs text-amber-600">ยังปรับแก้ได้ก่อนกดยืนยัน</p>
        )}
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

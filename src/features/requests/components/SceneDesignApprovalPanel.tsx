"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { MontageSceneAsset, ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import type { OrderedSourceAsset } from "@/lib/sourceAssets";
import { AssetType } from "@/domain/enums/AssetType";
import { CREDITS_CONFIG, PIPELINE_STEP_COSTS } from "@/config/credits";
import { MontageSceneAssetsEditor } from "@/features/requests/components/MontageSceneAssetsEditor";
import {
  assetPlaySeconds,
  minMontageTotalSeconds,
  sceneMontageSeconds,
} from "@/config/montage";

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
  /** Aspect ratio of the primary distribution channel (e.g. "9:16"). Scene-clip
   *  previews are shaped to this so they match how the final video will look. */
  primaryAspectRatio: string | null;
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
  primaryAspectRatio,
  sourceAssets,
  orderedAssets,
  activeSceneIndex = 0,
}: SceneDesignApprovalPanelProps) {
  const router = useRouter();
  // Preserve the server-sized montage durations on load (they already cover the
  // voice + short intro/ending). Only re-split each scene's assets.
  const [scenes, setScenes] = useState<ScenePlan[]>(() => normalizeMontageScenes(initialScenes));
  const [scriptDraft, setScriptDraft] = useState<string>(scriptThai ?? "");
  const [isApproving, setIsApproving] = useState(false);
  const [isRegenVoice, setIsRegenVoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const round1 = (n: number) => Math.round(n * 10) / 10;

  // The rendered video length IS the sum of the scenes — there is no separate
  // "length" knob. It updates live as scene durations / clip trims change.
  const totalSceneSeconds = sceneTotal(scenes);

  // The montage (stills + trimmed clips) must be long enough to cover the whole
  // voiceover plus the short music intro and ending. Because every duration
  // input is whole seconds, present (and gate on) the ceiling of the fractional
  // floor so the target is actually reachable — e.g. voice 27.0s → floor 28.6s
  // → shown target 29s. The true-floor check keeps a tiny epsilon.
  const minTotalSeconds = minMontageTotalSeconds(voiceDurationSeconds ?? initialDurationSeconds);
  const requiredWholeSeconds = Math.ceil(minTotalSeconds - 1e-6);
  const meetsMinimum = totalSceneSeconds + 1e-6 >= minTotalSeconds;
  const deficitSeconds = Math.max(0, requiredWholeSeconds - totalSceneSeconds);
  // How much longer the picture runs than the voice needs — a mild "trailing
  // silence" hint (advisory only, never blocks approval).
  const overBySeconds = Math.max(0, totalSceneSeconds - minTotalSeconds);

  // The same strict minimum is enforced again by the server and merge step.
  const mergeBlocked = !meetsMinimum;

  // The submitted montage length follows the true scene length so what renders
  // matches. Length no longer affects price — a request is a single flat fee.
  const submitDurationSeconds = clampDuration(Math.ceil(totalSceneSeconds));
  const scriptDirty = scriptDraft.trim() !== (scriptThai ?? "").trim();

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
  // Any real shortage is blocked so approval cannot create a black tail or fail
  // at the following merge step.
  if (mergeBlocked) {
    blockers.push(
      `วิดีโอยังสั้นกว่าเวลาที่ต้องใช้ประมาณ ${round1(deficitSeconds)} วินาที — ` +
        `กรุณาเพิ่มความยาวฉาก/คลิป หรือกด “สร้างเสียงพากย์ใหม่” ให้บทพูดสั้นลง ก่อนรวมคลิป`
    );
  }

  const updateScene = (index: number, patch: Partial<ScenePlan>) => {
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
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

  /** One-click fix for the coverage gate: add the whole-second shortfall to a
   *  scene that CONTAINS A STILL, so the extra time animates (Ken Burns) rather
   *  than freezing a clip's final frame. Prefers the last still-bearing scene;
   *  falls back to the last scene when none has a still. */
  const autoExtendToCover = () => {
    if (scenes.length === 0 || deficitSeconds <= 0) return;
    const hasStill = (s: ScenePlan) =>
      (s.assets ?? []).some((a) => a.kind === "image");
    let targetIndex = scenes.length - 1;
    for (let i = scenes.length - 1; i >= 0; i--) {
      if (hasStill(scenes[i])) {
        targetIndex = i;
        break;
      }
    }
    const current = Number(scenes[targetIndex].durationSeconds) || 0;
    updateSceneDuration(targetIndex, current + Math.ceil(deficitSeconds));
  };

  const handleApprove = async () => {
    if (blockers.length > 0) {
      setError("กรุณาปรับแก้รายการด้านล่างก่อนดำเนินการต่อ");
      return;
    }
    setIsApproving(true);
    setError(null);
    try {
      // Belt-and-suspenders: keep each montage scene's per-asset durations
      // consistent (trimmed clips pinned, stills rebalanced) before the renderer
      // consumes them.
      const scenePlan = scenes.map(reallocateSceneAssets);
      const res = await fetch(`/api/requests/${requestId}/scene-design/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, scenePlan, durationSeconds: submitDurationSeconds }),
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

  /** Redo the voiceover. Optionally save the edited script first (so the new
   *  audio speaks the new words). This steps the pipeline back to the voice
   *  stage; the scene plan is rebuilt once the new voice is approved. */
  const handleRegenerateVoice = async (opts?: { saveScript?: boolean }) => {
    const confirmMsg =
      "สร้างเสียงพากย์ใหม่เพื่อฟังผลลัพธ์? ระบบจะพากลับไปขั้นตอนเสียงพากย์ และออกแบบแผนฉากใหม่จากความยาวเสียงที่ได้";
    if (typeof window !== "undefined" && !window.confirm(confirmMsg)) return;

    setIsRegenVoice(true);
    setError(null);
    try {
      if (opts?.saveScript) {
        const patch = await fetch(`/api/requests/${requestId}/script`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, scriptThai: scriptDraft }),
        });
        if (!patch.ok) {
          const body = await patch.json().catch(() => ({}));
          throw new Error(body.error ?? "ไม่สามารถบันทึกบทพูดได้");
        }
      }
      const res = await fetch(`/api/requests/${requestId}/voice/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถสร้างเสียงพากย์ใหม่ได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsRegenVoice(false);
    }
  };

  const busy = isApproving || isRegenVoice;

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm font-semibold text-purple-800">สคริปต์วิดีโอพร้อมให้ตรวจสอบ</p>
        <p className="mt-0.5 text-sm text-purple-700">
          AI ออกแบบแผนฉากจากบทพูดที่อนุมัติแล้ว โดยอ้างอิงความยาวเสียงพากย์
          {voiceDurationSeconds ? ` ${voiceDurationSeconds.toFixed(1)} วินาที` : ""} ตรวจสอบเวลา ภาพประกอบ และคำอธิบายฉากก่อนเริ่มสร้างวิดีโอ
        </p>
      </div>

      {/* Editable Thai script. De-coupled from the voice: edit freely; when you
          want to hear the result, click "สร้างเสียงพากย์ใหม่" (by the player). */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          บทพูด (แก้ไขได้)
        </h3>
        <textarea
          value={scriptDraft}
          onChange={(e) => setScriptDraft(e.target.value)}
          rows={4}
          disabled={busy}
          className={`${ta} text-sm leading-relaxed text-slate-700`}
          placeholder="บทพูดสำหรับเสียงพากย์"
        />
        {scriptDirty && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-xs text-amber-700">
              แก้บทพูดแล้ว — กด “สร้างเสียงพากย์ใหม่” ด้านล่างเพื่อฟังผลลัพธ์ใหม่
            </p>
            <Button
              variant="secondary"
              onClick={() => setScriptDraft(scriptThai ?? "")}
              disabled={busy}
            >
              ยกเลิกการแก้ไข
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700">ความยาววิดีโอรวม</label>
          <span
            className={`rounded-full px-3 py-0.5 text-sm font-bold text-white tabular-nums ${
              meetsMinimum ? "bg-blue-600" : "bg-amber-500"
            }`}
          >
            {round1(totalSceneSeconds)} วินาที
          </span>
        </div>
        <p className="text-xs text-slate-500">
          คำนวณอัตโนมัติจากผลรวมความยาวของทุกฉากด้านล่าง — ปรับความยาวได้ที่แต่ละฉาก หรือด้วยการเลือกช่วงคลิป
        </p>
        {voiceDurationSeconds ? (
          <p className="mt-1 text-xs text-slate-500">
            ต้องคลุมเสียงพากย์ {voiceDurationSeconds.toFixed(1)} วินาที — อย่างน้อย{" "}
            <span className="font-semibold text-slate-600">{requiredWholeSeconds} วินาที</span>
          </p>
        ) : null}

        {!meetsMinimum && (
          <div
            className={`mt-3 flex flex-wrap items-center gap-3 rounded-lg border p-3 ${
              mergeBlocked ? "border-red-300 bg-red-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <p className={`text-xs ${mergeBlocked ? "text-red-700" : "text-amber-700"}`}>
              {mergeBlocked
                ? `วิดีโอยังสั้นกว่าเวลาที่ต้องใช้ประมาณ ${round1(deficitSeconds)} วินาที — ` +
                  `ยังรวมคลิปไม่ได้ กรุณาเพิ่มความยาวฉาก/คลิป หรือกด “สร้างเสียงพากย์ใหม่” ให้บทพูดสั้นลง`
                : `คำแนะนำ: เสียงพากย์ยาวกว่าความยาววิดีโอรวมประมาณ ${round1(deficitSeconds)} วินาที — ` +
                  `แนะนำให้เพิ่มความยาวฉาก/คลิป หรือแก้บทพูดให้สั้นลงแล้วกด “สร้างเสียงพากย์ใหม่” ` +
                  `(หากไม่ปรับ ช่วงท้ายที่ไม่มีภาพจะเป็นฉากสีดำโดยเสียงพากย์ยังเล่นต่อ)`}
            </p>
            <Button
              variant="secondary"
              onClick={autoExtendToCover}
              disabled={busy}
              className="ml-auto"
            >
              เพิ่มให้อัตโนมัติ
            </Button>
          </div>
        )}
        {meetsMinimum && overBySeconds > 2 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">
              คำแนะนำ: ความยาววิดีโอมากกว่าเสียงพากย์ประมาณ {round1(overBySeconds)} วินาที —
              หากไม่ต้องการช่วงท้ายที่ไม่มีเสียง ให้ลดความยาวฉาก/คลิป
            </p>
          </div>
        )}

        {voiceRecordingUrl && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                เสียงพากย์ที่อนุมัติ
              </p>
              <Button
                variant="secondary"
                onClick={() => handleRegenerateVoice({ saveScript: scriptDirty })}
                loading={isRegenVoice}
                disabled={busy}
              >
                สร้างเสียงพากย์ใหม่
              </Button>
            </div>
            <audio
              key={voiceRecordingAssetId ?? voiceRecordingUrl}
              src={voiceRecordingUrl}
              controls
              preload="metadata"
              className="w-full"
            />
          </div>
        )}

        <div className="mt-4 rounded-lg border border-green-100 bg-green-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-green-800">
                ความยาวนี้ไม่มีค่าใช้จ่ายเพิ่มเติม
              </p>
              <p className="mt-0.5 text-xs text-green-700">
                ความยาว {submitDurationSeconds} วินาที · ครอบคลุมด้วยค่าบริการครั้งเดียวแล้ว
              </p>
            </div>
            <div className="rounded-lg border border-green-200 bg-white px-3 py-2 text-right">
              <p className="text-lg font-bold text-green-700 tabular-nums">
                {CREDITS_CONFIG.REQUEST_COST_CREDITS}
              </p>
              <p className="text-xs text-slate-400">เครดิต (ครั้งเดียว)</p>
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
            แผนฉาก · ความยาววิดีโอรวม {round1(totalSceneSeconds)} วินาที
          </h3>
          {!meetsMinimum && (
            <span className="text-xs text-amber-600">
              แนะนำ ≥ {requiredWholeSeconds} วินาที เพื่อคลุมเสียงพากย์
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
                aspectRatio={primaryAspectRatio}
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
        <Button onClick={handleApprove} loading={isApproving} disabled={busy || mergeBlocked}>
          อนุมัติแผนฉากและสร้างวิดีโอ →
        </Button>
        {mergeBlocked ? (
          <p className="text-xs text-red-600">
            ต้องแก้ปัญหาเสียงพากย์ยาวเกินไปก่อน จึงจะรวมคลิปได้
          </p>
        ) : blockers.length > 0 ? (
          <p className="text-xs text-amber-600">ยังปรับแก้ได้ก่อนกดยืนยัน</p>
        ) : null}
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

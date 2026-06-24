"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

const FAILED_STEP_LABELS: Partial<Record<VideoGenerationStep, string>> = {
  [VideoGenerationStep.AnalyzingContent]:    "การวิเคราะห์เนื้อหา (AI)",
  [VideoGenerationStep.GeneratingBaseVideo]: "การสร้างวิดีโอ (Veo AI)",
  [VideoGenerationStep.GeneratingVoice]:     "การสร้างเสียงพากย์ (AI)",
  [VideoGenerationStep.ProcessingVoice]:     "การประมวลผลเสียง",
  [VideoGenerationStep.ComposingFinalVideo]: "การตัดต่อวิดีโอ (FFmpeg)",
};

interface EditedScene {
  visualDescriptionThai: string;
  durationSeconds: number;
  imageIndexes: number[];
}

interface SourceImageOption {
  sourceIndex: number;
  id: string;
  fileName: string;
  thumbnailUrl: string;
  storageUrl: string;
}

interface Props {
  requestId: string;
  jobId: string;
  failedAtStep: VideoGenerationStep | null;
  scenePlan: ScenePlan[];
  sourceImages: SourceImageOption[];
  voiceRecordingUrl?: string | null;
  scriptThai: string | null;
  hookThai: string | null;
}

export function PipelineFailurePanel({
  requestId,
  jobId,
  failedAtStep,
  scenePlan,
  sourceImages,
  voiceRecordingUrl = null,
  scriptThai,
  hookThai,
}: Props) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isVoiceRecreating, setIsVoiceRecreating] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [editedHookThai, setEditedHookThai] = useState(hookThai ?? "");
  const [editedScriptThai, setEditedScriptThai] = useState(scriptThai ?? "");
  const [editedScenes, setEditedScenes] = useState<EditedScene[]>(
    scenePlan.map((s) => ({
      visualDescriptionThai: s.visualDescriptionThai ?? s.visualDescription ?? "",
      durationSeconds: Number.isFinite(s.durationSeconds) ? s.durationSeconds : 1,
      imageIndexes: (s.imageIndexes ?? []).slice(0, 2),
    }))
  );

  const failedStepLabel =
    failedAtStep ? (FAILED_STEP_LABELS[failedAtStep] ?? failedAtStep) : "ไม่ทราบขั้นตอน";

  // Audio-first reorder: GeneratingVoice now runs immediately after content
  // approval, before any video exists. A failure here is just the first
  // generative step failing — handled by the generic retry panel below
  // (which already supports editing the script/hook/scenes before retrying).

  const handleSceneChange = (index: number, field: keyof EditedScene, value: string | number) => {
    setEditedScenes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleCancelEdit = () => {
    setEditedHookThai(hookThai ?? "");
    setEditedScriptThai(scriptThai ?? "");
    setEditedScenes(
      scenePlan.map((s) => ({
        visualDescriptionThai: s.visualDescriptionThai ?? s.visualDescription ?? "",
        durationSeconds: Number.isFinite(s.durationSeconds) ? s.durationSeconds : 1,
        imageIndexes: (s.imageIndexes ?? []).slice(0, 2),
      }))
    );
    setIsEditing(false);
  };

  const handleSceneImageToggle = (sceneIndex: number, sourceIndex: number) => {
    setEditedScenes((prev) => {
      const next = [...prev];
      const scene = next[sceneIndex];
      const current = scene?.imageIndexes ?? [];
      const imageIndexes = current.includes(sourceIndex)
        ? current.filter((idx) => idx !== sourceIndex)
        : [...current, sourceIndex].slice(0, 2);

      next[sceneIndex] = {
        ...scene,
        imageIndexes,
        durationSeconds: imageIndexes.length === 2 ? 8 : scene.durationSeconds,
      };
      return next;
    });
  };

  const saveDraft = useCallback(async () => {
    const hasContent = hookThai !== null || scenePlan.length > 0 || scriptThai !== null;
    if (!hasContent) return;

    const res = await fetch(`/api/requests/${requestId}/script`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        hookThai: hookThai !== null ? editedHookThai : undefined,
        scriptThai: scriptThai !== null ? editedScriptThai : undefined,
        scenes: scenePlan.length > 0 ? editedScenes : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Autosave failed.");
    }

    setSaveError(null);
    setLastSavedAt(new Date());
  }, [
    editedHookThai,
    editedScenes,
    editedScriptThai,
    hookThai,
    jobId,
    requestId,
    scenePlan.length,
    scriptThai,
  ]);

  useEffect(() => {
    if (!isEditing) return;
    const timer = window.setTimeout(() => {
      saveDraft().catch((err) => {
        setSaveError(err instanceof Error ? err.message : "Autosave failed.");
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [isEditing, saveDraft]);

  const handleRegenerateVoice = async () => {
    setIsVoiceRecreating(true);
    setRetryError(null);
    try {
      await saveDraft();

      const res = await fetch(`/api/requests/${requestId}/voice/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Voice regeneration failed.");
      }

      router.refresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Voice regeneration failed.");
      setIsVoiceRecreating(false);
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryError(null);
    try {
      await saveDraft();
      const hasContent = hookThai !== null || scenePlan.length > 0 || scriptThai !== null;

      const editedContent = hasContent
        ? {
            hookThai: hookThai !== null ? editedHookThai : null,
            scriptThai: scriptThai !== null ? editedScriptThai : null,
            scenes: editedScenes,
          }
        : undefined;

      const res = await fetch(`/api/requests/${requestId}/retry-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, editedContent }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถลองอีกครั้งได้");
      }

      // Soft refresh — re-render the server component with the new pipeline
      // step without pushing a history entry.
      router.refresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
      setIsRetrying(false);
    }
  };

  const hasContent = hookThai !== null || scenePlan.length > 0 || scriptThai !== null;

  return (
    <div className="mb-6 flex flex-col gap-4">
      {/* Error banner */}
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-800">
          เกิดข้อผิดพลาดในขั้นตอน: {failedStepLabel}
        </p>
        <p className="mt-1 text-sm text-red-700">
          กระบวนการผลิตหยุดชะงัก ตรวจสอบข้อมูลที่ส่งด้านล่างแล้วกด &quot;ลองอีกครั้ง&quot;
        </p>
      </div>

      {/* Submitted content — with inline edit toggle */}
      {hasContent && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              ข้อมูลที่ส่งในขั้นตอนนี้
            </p>
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                แก้ไขข้อมูล
              </button>
            ) : (
              <button
                onClick={handleCancelEdit}
                className="text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                ยกเลิก
              </button>
            )}
          </div>

          {/* Hook */}
          {hookThai !== null && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-medium text-slate-400">ฮุค (3 วินาทีแรก)</p>
              {isEditing ? (
                <textarea
                  value={editedHookThai}
                  onChange={(e) => setEditedHookThai(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none resize-none"
                  placeholder="ฮุคภาษาไทย"
                />
              ) : (
                <p className="text-sm text-slate-800">{editedHookThai}</p>
              )}
            </div>
          )}

          {/* Scene plan */}
          {scenePlan.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium text-slate-400">แผนฉาก</p>
              <div className="flex flex-col gap-2">
                {scenePlan.map((scene, idx) => (
                  <div
                    key={scene.sceneNumber}
                    className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                        ฉาก {scene.sceneNumber}
                      </span>
                      <span className="text-xs text-slate-400">{scene.durationSeconds} วินาที</span>
                    </div>
                    {isEditing ? (
                      <>
                        <label className="mb-2 flex items-center gap-2 text-xs text-slate-500 [&>span:nth-of-type(2)]:hidden">
                          <span>seconds</span>
                          <span>เธงเธดเธเธฒเธ—เธต</span>
                          <input
                            type="number"
                            min={1}
                            max={30}
                            step={1}
                            value={editedScenes[idx]?.durationSeconds ?? scene.durationSeconds}
                            disabled={(editedScenes[idx]?.imageIndexes.length ?? 0) === 2}
                            onChange={(e) =>
                              handleSceneChange(
                                idx,
                                "durationSeconds",
                                Math.max(1, Number(e.target.value) || 1)
                              )
                            }
                            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 focus:border-blue-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </label>
                        {sourceImages.length > 0 && (
                          <div className="mb-2">
                            <p className="mb-1 text-xs font-medium text-slate-500">
                              Select images (max 2)
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {sourceImages.map((image) => {
                                const selected =
                                  editedScenes[idx]?.imageIndexes.includes(image.sourceIndex) ?? false;
                                const maxSelected =
                                  (editedScenes[idx]?.imageIndexes.length ?? 0) >= 2 && !selected;
                                const thumbSrc = image.thumbnailUrl || image.storageUrl;

                                return (
                                  <button
                                    type="button"
                                    key={image.id}
                                    disabled={maxSelected}
                                    onClick={() => handleSceneImageToggle(idx, image.sourceIndex)}
                                    className={`overflow-hidden rounded-md border text-left transition ${
                                      selected
                                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                                        : "border-slate-200 bg-white hover:border-blue-200"
                                    } disabled:cursor-not-allowed disabled:opacity-40`}
                                  >
                                    <div className="aspect-video bg-slate-100">
                                      {thumbSrc ? (
                                        <img
                                          src={thumbSrc}
                                          alt=""
                                          className="h-full w-full object-cover"
                                        />
                                      ) : null}
                                    </div>
                                    <div className="px-2 py-1">
                                      <p className="truncate text-xs text-slate-600">
                                        {selected ? "Selected" : "Image"} {image.sourceIndex + 1}
                                      </p>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                            {(editedScenes[idx]?.imageIndexes.length ?? 0) === 2 && (
                              <p className="mt-1 text-xs text-blue-600">
                                Two images selected: scene time is fixed at 8 seconds for morphing.
                              </p>
                            )}
                          </div>
                        )}
                      <textarea
                        value={editedScenes[idx]?.visualDescriptionThai ?? ""}
                        onChange={(e) => handleSceneChange(idx, "visualDescriptionThai", e.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none resize-none"
                        placeholder="คำอธิบายภาพ"
                      />
                      </>
                    ) : (
                      <p className="text-sm text-slate-700">
                        {editedScenes[idx]?.visualDescriptionThai ?? scene.visualDescriptionThai}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Script */}
          {scriptThai !== null && (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">บทพูด</p>
              {isEditing ? (
                <textarea
                  value={editedScriptThai}
                  onChange={(e) => setEditedScriptThai(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none resize-none"
                  placeholder="บทพูดภาษาไทย"
                />
              ) : (
                <p className="text-sm text-slate-800">{editedScriptThai}</p>
              )}
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {voiceRecordingUrl ? (
                  <audio controls src={voiceRecordingUrl} className="w-full" />
                ) : (
                  <p className="text-xs text-slate-500">No generated voice is available yet.</p>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">
                    {saveError
                      ? `Autosave failed: ${saveError}`
                      : lastSavedAt
                        ? `Autosaved ${lastSavedAt.toLocaleTimeString()}`
                        : isEditing
                          ? "Autosave is ready"
                          : "Edit the script to autosave changes"}
                  </p>
                  <button
                    type="button"
                    onClick={handleRegenerateVoice}
                    disabled={isVoiceRecreating || !editedScriptThai.trim()}
                    className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isVoiceRecreating ? "กำลังสร้างเสียง..." : "สร้างเสียงพากย์ใหม่"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {retryError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{retryError}</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleRetry}
          disabled={isRetrying}
          className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isRetrying ? "กำลังลองอีกครั้ง..." : "ลองอีกครั้ง →"}
        </button>
      </div>
    </div>
  );
}

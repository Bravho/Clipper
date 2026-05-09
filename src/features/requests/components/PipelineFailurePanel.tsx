"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

const FAILED_STEP_LABELS: Partial<Record<VideoGenerationStep, string>> = {
  [VideoGenerationStep.AnalyzingContent]:    "การวิเคราะห์เนื้อหา (AI)",
  [VideoGenerationStep.GeneratingBaseVideo]: "การสร้างวิดีโอ (Kling AI)",
  [VideoGenerationStep.ProcessingVoice]:     "การประมวลผลเสียง (ElevenLabs)",
  [VideoGenerationStep.ComposingFinalVideo]: "การตัดต่อวิดีโอ (FFmpeg)",
};

interface EditedScene {
  visualDescription: string;
  motionNotes: string;
}

interface Props {
  requestId: string;
  jobId: string;
  failedAtStep: VideoGenerationStep | null;
  scenePlan: ScenePlan[];
  scriptThai: string | null;
  scriptEnglish: string | null;
  hookThai: string | null;
  hookEnglish: string | null;
}

export function PipelineFailurePanel({
  requestId,
  jobId,
  failedAtStep,
  scenePlan,
  scriptThai,
  scriptEnglish,
  hookThai,
  hookEnglish,
}: Props) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [editedHookThai, setEditedHookThai] = useState(hookThai ?? "");
  const [editedHookEnglish, setEditedHookEnglish] = useState(hookEnglish ?? "");
  const [editedScriptThai, setEditedScriptThai] = useState(scriptThai ?? "");
  const [editedScriptEnglish, setEditedScriptEnglish] = useState(scriptEnglish ?? "");
  const [editedScenes, setEditedScenes] = useState<EditedScene[]>(
    scenePlan.map((s) => ({
      visualDescription: s.visualDescription,
      motionNotes: s.motionNotes ?? "",
    }))
  );

  const failedStepLabel =
    failedAtStep ? (FAILED_STEP_LABELS[failedAtStep] ?? failedAtStep) : "ไม่ทราบขั้นตอน";

  const handleSceneChange = (index: number, field: keyof EditedScene, value: string) => {
    setEditedScenes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleCancelEdit = () => {
    setEditedHookThai(hookThai ?? "");
    setEditedHookEnglish(hookEnglish ?? "");
    setEditedScriptThai(scriptThai ?? "");
    setEditedScriptEnglish(scriptEnglish ?? "");
    setEditedScenes(
      scenePlan.map((s) => ({
        visualDescription: s.visualDescription,
        motionNotes: s.motionNotes ?? "",
      }))
    );
    setIsEditing(false);
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryError(null);
    try {
      const hasContent =
        hookThai !== null || hookEnglish !== null || scenePlan.length > 0 ||
        scriptThai !== null || scriptEnglish !== null;

      const editedContent = hasContent
        ? {
            hookThai: hookThai !== null ? editedHookThai : null,
            hookEnglish: hookEnglish !== null ? editedHookEnglish : null,
            scriptThai: scriptThai !== null ? editedScriptThai : null,
            scriptEnglish: scriptEnglish !== null ? editedScriptEnglish : null,
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
      router.refresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
      setIsRetrying(false);
    }
  };

  const hasContent =
    hookThai !== null || hookEnglish !== null || scenePlan.length > 0 ||
    scriptThai !== null || scriptEnglish !== null;

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
          {(hookThai !== null || hookEnglish !== null) && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-medium text-slate-400">ฮุค (3 วินาทีแรก)</p>
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  {hookThai !== null && (
                    <textarea
                      value={editedHookThai}
                      onChange={(e) => setEditedHookThai(e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none resize-none"
                      placeholder="ฮุคภาษาไทย"
                    />
                  )}
                  {hookEnglish !== null && (
                    <textarea
                      value={editedHookEnglish}
                      onChange={(e) => setEditedHookEnglish(e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs italic text-slate-600 focus:border-blue-500 focus:outline-none resize-none"
                      placeholder="Hook in English"
                    />
                  )}
                </div>
              ) : (
                <>
                  {hookThai !== null && (
                    <p className="text-sm text-slate-800">{editedHookThai}</p>
                  )}
                  {hookEnglish !== null && (
                    <p className="mt-0.5 text-xs italic text-slate-500">{editedHookEnglish}</p>
                  )}
                </>
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
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                        ฉาก {scene.sceneNumber}
                      </span>
                      <span className="text-xs text-slate-400">{scene.durationSeconds} วินาที</span>
                    </div>
                    {isEditing ? (
                      <div className="flex flex-col gap-1.5">
                        <textarea
                          value={editedScenes[idx]?.visualDescription ?? ""}
                          onChange={(e) => handleSceneChange(idx, "visualDescription", e.target.value)}
                          rows={3}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none resize-none"
                          placeholder="Visual description"
                        />
                        <textarea
                          value={editedScenes[idx]?.motionNotes ?? ""}
                          onChange={(e) => handleSceneChange(idx, "motionNotes", e.target.value)}
                          rows={1}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-500 focus:border-blue-500 focus:outline-none resize-none"
                          placeholder="Motion notes (optional)"
                        />
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-slate-700">
                          {editedScenes[idx]?.visualDescription ?? scene.visualDescription}
                        </p>
                        {(editedScenes[idx]?.motionNotes || scene.motionNotes) && (
                          <p className="mt-0.5 text-xs text-slate-400">
                            {editedScenes[idx]?.motionNotes || scene.motionNotes}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Script */}
          {(scriptThai !== null || scriptEnglish !== null) && (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">บทพูด</p>
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  {scriptThai !== null && (
                    <textarea
                      value={editedScriptThai}
                      onChange={(e) => setEditedScriptThai(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none resize-none"
                      placeholder="บทพูดภาษาไทย"
                    />
                  )}
                  {scriptEnglish !== null && (
                    <textarea
                      value={editedScriptEnglish}
                      onChange={(e) => setEditedScriptEnglish(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs italic text-slate-600 focus:border-blue-500 focus:outline-none resize-none"
                      placeholder="Script in English"
                    />
                  )}
                </div>
              ) : (
                <>
                  {scriptThai !== null && (
                    <p className="text-sm text-slate-800">{editedScriptThai}</p>
                  )}
                  {scriptEnglish !== null && (
                    <p className="mt-1 text-xs italic text-slate-500">{editedScriptEnglish}</p>
                  )}
                </>
              )}
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

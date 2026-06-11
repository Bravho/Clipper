"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

const FAILED_STEP_LABELS: Partial<Record<VideoGenerationStep, string>> = {
  [VideoGenerationStep.AnalyzingContent]:    "การวิเคราะห์เนื้อหา (AI)",
  [VideoGenerationStep.GeneratingBaseVideo]: "การสร้างวิดีโอ (Kling AI)",
  [VideoGenerationStep.GeneratingVoice]:     "การสร้างเสียงพากย์ (AI)",
  [VideoGenerationStep.ProcessingVoice]:     "การประมวลผลเสียง",
  [VideoGenerationStep.ComposingFinalVideo]: "การตัดต่อวิดีโอ (FFmpeg)",
};

interface EditedScene {
  visualDescriptionThai: string;
}

interface Props {
  requestId: string;
  jobId: string;
  failedAtStep: VideoGenerationStep | null;
  scenePlan: ScenePlan[];
  scriptThai: string | null;
  hookThai: string | null;
}

export function PipelineFailurePanel({
  requestId,
  jobId,
  failedAtStep,
  scenePlan,
  scriptThai,
  hookThai,
}: Props) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [editedHookThai, setEditedHookThai] = useState(hookThai ?? "");
  const [editedScriptThai, setEditedScriptThai] = useState(scriptThai ?? "");
  const [editedScenes, setEditedScenes] = useState<EditedScene[]>(
    scenePlan.map((s) => ({
      visualDescriptionThai: s.visualDescriptionThai ?? s.visualDescription ?? "",
    }))
  );

  const failedStepLabel =
    failedAtStep ? (FAILED_STEP_LABELS[failedAtStep] ?? failedAtStep) : "ไม่ทราบขั้นตอน";

  // Voice generation failure: the base video already exists and is fine —
  // only the AI voiceover needs to be (re)generated. Show a focused panel
  // with just the speaking script and a "generate voice" action.
  const isVoiceFailure = failedAtStep === VideoGenerationStep.GeneratingVoice;

  const handleSceneChange = (index: number, field: keyof EditedScene, value: string) => {
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
      }))
    );
    setIsEditing(false);
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryError(null);
    try {
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

      if (isVoiceFailure) {
        // Voice generation is quick (5-15 s) — stay on this panel with an
        // inline loading indicator and poll until the step advances, instead
        // of refreshing into the generic processing card.
        const maxAttempts = 90;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          const statusRes = await fetch(`/api/requests/${requestId}/pipeline-status`, {
            cache: "no-store",
          });
          if (!statusRes.ok) continue;
          const status = await statusRes.json();
          if (status.currentStep === VideoGenerationStep.Failed) {
            throw new Error(
              "การสร้างเสียงพากย์ล้มเหลว กรุณาลองอีกครั้ง (ตรวจสอบ console ของเซิร์ฟเวอร์)"
            );
          }
          if (status.currentStep === VideoGenerationStep.AwaitingVoiceApproval) {
            router.refresh();
            return;
          }
        }
        throw new Error("หมดเวลารอการสร้างเสียงพากย์ กรุณาลองอีกครั้ง");
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

  // Focused panel for voice failures — video is already done, only the
  // voiceover needs generating.
  if (isVoiceFailure) {
    return (
      <div className="mb-6 flex flex-col gap-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            ขั้นตอนถัดไป: การสร้างเสียงพากย์ (AI)
          </p>
          <p className="mt-1 text-sm text-amber-700">
            วิดีโอของคุณพร้อมแล้ว — ตรวจสอบบทพูดด้านล่างแล้วกด
            &quot;สร้างเสียงพากย์&quot; เพื่อสร้างเสียงด้วย AI
          </p>
        </div>

        {scriptThai !== null && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                บทพูด
              </p>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  แก้ไขบทพูด
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
            {isRetrying ? "กำลังสร้างเสียงพากย์..." : "สร้างเสียงพากย์ →"}
          </button>
        </div>

        {/* Inline loading status — shown right below the button while generating */}
        {isRetrying && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
            <p className="text-sm text-blue-700">
              AI กำลังสร้างเสียงพากย์จากบทพูดด้านบน ใช้เวลาประมาณ 5-15 วินาที...
            </p>
          </div>
        )}
      </div>
    );
  }

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
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                        ฉาก {scene.sceneNumber}
                      </span>
                      <span className="text-xs text-slate-400">{scene.durationSeconds} วินาที</span>
                    </div>
                    {isEditing ? (
                      <textarea
                        value={editedScenes[idx]?.visualDescriptionThai ?? ""}
                        onChange={(e) => handleSceneChange(idx, "visualDescriptionThai", e.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none resize-none"
                        placeholder="คำอธิบายภาพ"
                      />
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

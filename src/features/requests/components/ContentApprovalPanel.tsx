"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

interface ContentApprovalPanelProps {
  requestId: string;
  initialScenes: ScenePlan[];
  initialHookThai: string | null;
  initialHookEnglish: string | null;
  initialScriptThai: string | null;
  initialScriptEnglish: string | null;
  initialCaptionThai: string | null;
  initialCaptionEnglish: string | null;
  initialCaptionChinese: string | null;
}

const ta =
  "w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300";

export function ContentApprovalPanel({
  requestId,
  initialScenes,
  initialHookThai,
  initialHookEnglish,
  initialScriptThai,
  initialScriptEnglish,
  initialCaptionThai,
  initialCaptionEnglish,
  initialCaptionChinese,
}: ContentApprovalPanelProps) {
  const router = useRouter();
  const [hookThai, setHookThai] = useState(initialHookThai ?? "");
  const [hookEnglish, setHookEnglish] = useState(initialHookEnglish ?? "");
  const [scriptThai, setScriptThai] = useState(initialScriptThai ?? "");
  const [scriptEnglish, setScriptEnglish] = useState(initialScriptEnglish ?? "");
  const [captionThai, setCaptionThai] = useState(initialCaptionThai ?? "");
  const [captionEnglish, setCaptionEnglish] = useState(initialCaptionEnglish ?? "");
  const [captionChinese, setCaptionChinese] = useState(initialCaptionChinese ?? "");
  const [scenes, setScenes] = useState<ScenePlan[]>(initialScenes);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateScene = (index: number, field: string, value: string) => {
    setScenes((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const handleApprove = async () => {
    setIsApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/start-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenePlan: scenes,
          scriptThai,
          scriptEnglish,
          hookThai,
          hookEnglish,
          captionThai,
          captionEnglish,
          captionChinese,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถเริ่มสร้างวิดีโอได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsApproving(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-4">
      {/* Banner */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-800">สคริปต์พร้อมให้ตรวจสอบ</p>
        <p className="mt-0.5 text-sm text-blue-700">
          AI สร้างแผนฉากและบทพูดด้านล่างแล้ว แก้ไขได้ตามต้องการ จากนั้นคลิก{" "}
          <strong>อนุมัติและสร้างวิดีโอ</strong> เพื่อเริ่มให้ Kling AI สร้างวิดีโอ
        </p>
      </div>

      {/* Hook */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          ฮุค (3 วินาทีแรก)
        </h3>
        <div className="flex flex-col gap-2">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">ภาษาไทย</p>
            <textarea
              value={hookThai}
              onChange={(e) => setHookThai(e.target.value)}
              rows={2}
              className={`${ta} text-sm text-slate-800`}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">English</p>
            <textarea
              value={hookEnglish}
              onChange={(e) => setHookEnglish(e.target.value)}
              rows={2}
              className={`${ta} text-sm italic text-slate-500`}
            />
          </div>
        </div>
      </div>

      {/* Scene plan */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          แผนฉาก
        </h3>
        <div className="flex flex-col gap-3">
          {scenes.map((scene, index) => (
            <div
              key={scene.sceneNumber}
              className="rounded-lg border border-slate-100 bg-slate-50 p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                  ฉาก {scene.sceneNumber}
                </span>
                <span className="text-xs text-slate-400">{scene.durationSeconds} วินาที</span>
              </div>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-400">คำอธิบายภาพ (ไทย)</p>
                  <textarea
                    value={scene.visualDescriptionThai ?? ""}
                    onChange={(e) => updateScene(index, "visualDescriptionThai", e.target.value)}
                    rows={2}
                    className={`${ta} text-sm text-slate-700`}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-400">Visual Description (EN)</p>
                  <textarea
                    value={scene.visualDescription}
                    onChange={(e) => updateScene(index, "visualDescription", e.target.value)}
                    rows={2}
                    className={`${ta} text-sm text-slate-700`}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-400">หมายเหตุการเคลื่อนไหว (ไทย)</p>
                  <textarea
                    value={scene.motionNotesThai ?? ""}
                    onChange={(e) => updateScene(index, "motionNotesThai", e.target.value)}
                    rows={2}
                    className={`${ta} text-xs text-slate-500`}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-400">Motion Notes (EN)</p>
                  <textarea
                    value={scene.motionNotes}
                    onChange={(e) => updateScene(index, "motionNotes", e.target.value)}
                    rows={2}
                    className={`${ta} text-xs text-slate-400`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Script */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">บทพูด</h3>
        <div className="flex flex-col gap-2">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">ภาษาไทย</p>
            <textarea
              value={scriptThai}
              onChange={(e) => setScriptThai(e.target.value)}
              rows={4}
              className={`${ta} text-sm text-slate-800`}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">English</p>
            <textarea
              value={scriptEnglish}
              onChange={(e) => setScriptEnglish(e.target.value)}
              rows={4}
              className={`${ta} text-sm italic text-slate-500`}
            />
          </div>
        </div>
      </div>

      {/* Captions */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          แคปชั่นโซเชียล
        </h3>
        <div className="flex flex-col gap-2">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">ภาษาไทย</p>
            <textarea
              value={captionThai}
              onChange={(e) => setCaptionThai(e.target.value)}
              rows={3}
              className={`${ta} text-sm text-slate-700`}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">English</p>
            <textarea
              value={captionEnglish}
              onChange={(e) => setCaptionEnglish(e.target.value)}
              rows={3}
              className={`${ta} text-sm text-slate-700`}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">中文</p>
            <textarea
              value={captionChinese}
              onChange={(e) => setCaptionChinese(e.target.value)}
              rows={3}
              className={`${ta} text-sm text-slate-700`}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex justify-end pb-2">
        <Button onClick={handleApprove} loading={isApproving} disabled={isApproving}>
          อนุมัติและสร้างวิดีโอ →
        </Button>
      </div>
    </div>
  );
}

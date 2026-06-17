"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface ContentApprovalPanelProps {
  requestId: string;
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
  initialScriptThai,
  initialScriptEnglish,
  initialCaptionThai,
  initialCaptionEnglish,
  initialCaptionChinese,
}: ContentApprovalPanelProps) {
  const router = useRouter();
  const [scriptThai, setScriptThai] = useState(initialScriptThai ?? "");
  const [captionThai, setCaptionThai] = useState(initialCaptionThai ?? "");
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setIsApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/start-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptThai,
          scriptEnglish: initialScriptEnglish,
          hookEnglish: null,
          captionThai,
          captionEnglish: initialCaptionEnglish,
          captionChinese: initialCaptionChinese,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถเริ่มสร้างเสียงพากย์ได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsApproving(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-800">บทพูดพร้อมให้ตรวจสอบ</p>
        <p className="mt-0.5 text-sm text-blue-700">
          AI สร้างบทพูดจากข้อมูลคำขอแล้ว ตรวจสอบหรือแก้ไขบทพูดก่อนกด{" "}
          <strong>สร้างเสียงพากย์</strong> ระบบจะสร้างเสียงด้วย iAppTTS
          ก่อน แล้วค่อยออกแบบฉากและฮุกในขั้นตอนถัดไป
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          บทพูด
        </h3>
        <textarea
          value={scriptThai}
          onChange={(e) => setScriptThai(e.target.value)}
          rows={5}
          className={`${ta} text-sm text-slate-800`}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          แคปชั่นเบื้องต้น
        </h3>
        <textarea
          value={captionThai}
          onChange={(e) => setCaptionThai(e.target.value)}
          rows={3}
          className={`${ta} text-sm text-slate-700`}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex justify-end pb-2">
        <Button onClick={handleApprove} loading={isApproving} disabled={isApproving || !scriptThai.trim()}>
          สร้างเสียงพากย์ →
        </Button>
      </div>
    </div>
  );
}

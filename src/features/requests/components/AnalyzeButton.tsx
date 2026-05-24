"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface AnalyzeButtonProps {
  requestId: string;
}

export function AnalyzeButton({ requestId }: AnalyzeButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "การวิเคราะห์ AI ล้มเหลว กรุณาลองอีกครั้ง");
      }
      router.push(pathname);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsAnalyzing(false);
    }
  };

  if (isAnalyzing) {
    return (
      <div className="flex items-center gap-2 text-sm text-blue-700">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        AI กำลังวิเคราะห์คำขอ — ประมาณ 15–30 วินาที
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleAnalyze}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800"
      >
        วิเคราะห์เนื้อหาด้วย AI →
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

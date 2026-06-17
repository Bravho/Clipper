"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface AnalyzeButtonProps {
  requestId: string;
}

export function AnalyzeButton({ requestId }: AnalyzeButtonProps) {
  const router = useRouter();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const handleAnalyze = async () => {
      if (isAnalyzing) return;
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
        if (!cancelled) router.refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
          setIsAnalyzing(false);
        }
      }
    };

    handleAnalyze();

    return () => {
      cancelled = true;
    };
  }, [requestId, router]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isAnalyzing || !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-blue-700">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        AI กำลังวิเคราะห์คำขอ — ประมาณ 15–30 วินาที
      </div>
    );
  }

  return (
    <div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

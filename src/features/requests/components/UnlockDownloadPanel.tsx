"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";

export interface DownloadableClip {
  id: string;
  label: string;
}

interface UnlockDownloadPanelProps {
  requestId: string;
  /** True when the clean download is still locked (unpaid trial request). */
  locked: boolean;
  /** True when this was the user's free trial request. */
  isTrial: boolean;
  /** Price in credits (= ฿) to unlock. */
  price: number;
  /** The clean final master clips available for download. */
  clips: DownloadableClip[];
}

/**
 * Pay-to-download paywall + gated download buttons.
 *
 * Locked  → shows the unlock CTA (charges `price` credits via /unlock-download).
 * Unlocked → shows per-clip download buttons that fetch a short-lived presigned
 *            URL from /download and open it.
 */
export function UnlockDownloadPanel({
  requestId,
  locked,
  isTrial,
  price,
  clips,
}: UnlockDownloadPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needTopup, setNeedTopup] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const unlock = async () => {
    setLoading(true);
    setError(null);
    setNeedTopup(false);
    try {
      const res = await fetch(`/api/requests/${requestId}/unlock-download`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 402) setNeedTopup(true);
        throw new Error(body.error ?? "ไม่สามารถปลดล็อกได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  };

  const download = async (assetId: string) => {
    setDownloadingId(assetId);
    setError(null);
    try {
      const res = await fetch(
        `/api/requests/${requestId}/download?assetId=${assetId}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ดาวน์โหลดไม่สำเร็จ");
      }
      const { url } = await res.json();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setDownloadingId(null);
    }
  };

  if (locked) {
    return (
      <Card className="mb-6 border-blue-200 bg-blue-50/40">
        <h2 className="mb-2 text-base font-semibold text-slate-900">
          {isTrial ? "วิดีโอทดลองใช้ฟรี — ปลดล็อกเพื่อดาวน์โหลด" : "ปลดล็อกการดาวน์โหลด"}
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          ดูตัวอย่างวิดีโอได้ฟรี ชำระ ฿{price} เพื่อดาวน์โหลดไฟล์ต้นฉบับความละเอียดเต็ม
          (ไม่มีลายน้ำ)
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={unlock} loading={loading}>
            ปลดล็อกด้วย {price} เครดิต (฿{price})
          </Button>
          {needTopup && (
            <Link
              href={ROUTES.CREDITS}
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              เครดิตไม่พอ — เติมเครดิตด้วย PromptPay →
            </Link>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-3 text-base font-semibold text-slate-900">
        ดาวน์โหลดวิดีโอ
      </h2>
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {clips.length === 0 ? (
        <p className="text-sm text-slate-500">ไฟล์วิดีโอจะปรากฏที่นี่เมื่อผลิตเสร็จ</p>
      ) : (
        <div className="flex flex-col gap-2">
          {clips.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2"
            >
              <span className="text-sm text-slate-700">{c.label}</span>
              <Button
                size="sm"
                variant="outline"
                loading={downloadingId === c.id}
                onClick={() => download(c.id)}
              >
                ดาวน์โหลด
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

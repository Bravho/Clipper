"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/client";

export interface DownloadableClip {
  id: string;
  label: string;
}

interface UnlockDownloadPanelProps {
  requestId: string;
  /** True when the clean download is still locked (unpaid preview request). */
  locked: boolean;
  /** Price in credits (= ฿) to unlock. */
  price: number;
  /** The clean final master clips available for download. */
  clips: DownloadableClip[];
}

/**
 * Pay-to-download paywall + gated download buttons.
 *
 * Only `free_preview` requests are ever locked: the account's free first clip and
 * every paid request are unlocked on delivery, so they land straight on the
 * download list.
 *
 * Locked  → shows the unlock CTA (charges `price` credits via /unlock-download).
 * Unlocked → shows per-clip download buttons backed by the authenticated,
 *            same-origin streaming endpoint.
 */
export function UnlockDownloadPanel({
  requestId,
  locked,
  price,
  clips,
}: UnlockDownloadPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const unlock = async () => {
    setLoading(true);
    setError(null);
    const returnTo = `/dashboard/requests/${requestId}`;
    router.push(
      `/dashboard/credits?unlockRequest=${encodeURIComponent(requestId)}&returnTo=${encodeURIComponent(returnTo)}`
    );
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
        throw new Error(body.error ?? t("unlock.failed"));
      }
      const { downloadUrl, fileName } = (await res.json()) as {
        downloadUrl: string;
        fileName?: string;
      };
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = fileName ?? "";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unlock.error"));
    } finally {
      setDownloadingId(null);
    }
  };

  if (locked) {
    return (
      <Card className="mb-6 border-blue-200 bg-blue-50/40">
        <h2 className="mb-2 text-base font-semibold text-slate-900">
          {t("unlock.lockedTitle")}
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          {t("unlock.lockedBody", { cost: price })}
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={unlock} loading={loading}>
            {t("unlock.cta", { cost: price })}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-3 text-base font-semibold text-slate-900">
        {t("unlock.downloadsTitle")}
      </h2>
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {clips.length === 0 ? (
        <p className="text-sm text-slate-500">{t("unlock.pending")}</p>
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
                {t("unlock.download")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

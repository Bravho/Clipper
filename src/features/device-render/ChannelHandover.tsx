"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { managementPublishReturnPath, ROUTES } from "@/config/routes";
import type { StudioOutput } from "./studioPipeline";
import { useStudioT } from "./studioI18n";

/** Channel Management as the studio page read it for this request. */
export interface StudioManagement {
  enabled: boolean;
  /** Finished video (export asset id) → its Channel Management item id. */
  transferredByAssetId: Record<string, string>;
}

/**
 * The studio's last stage: the finished videos go to Channel Management.
 *
 * Exactly what the old distribution step offered, as one step instead of a
 * button per video: every finished shape is copied into Channel Management
 * (free, idempotent — `POST /api/management/transfers`), carrying the caption
 * and title the server wrote for each channel. From there each video opens in
 * the publish flow (publish now or schedule, to the connected accounts).
 *
 * It sends by itself the first time the videos are all ready, since there is
 * nothing to decide before that; a failed send leaves a Try again button.
 * Downloads stay on the videos above for anyone posting by hand.
 */
export function ChannelHandover({
  requestId,
  outputs,
  labelFor,
  management,
}: {
  requestId: string;
  outputs: StudioOutput[];
  /** The channels a shape serves, for the per-video row. */
  labelFor: (ratio: string) => string;
  management: StudioManagement;
}) {
  const t = useStudioT();
  const [transferred, setTransferred] = useState<Record<string, string>>(
    management.transferredByAssetId
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  const pending = outputs.filter((output) => !transferred[output.assetId]);

  const sendAll = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/management/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRequestId: requestId, all: true }),
      });
      const body = (await response.json().catch(() => null)) as {
        items?: { id: string; sourceAssetId: string | null }[];
        error?: string;
      } | null;
      if (!response.ok || !body?.items) {
        throw new Error(body?.error ?? t("studio.handover.failed"));
      }
      setTransferred((current) => {
        const next = { ...current };
        for (const item of body.items ?? []) {
          if (item.sourceAssetId) next[item.sourceAssetId] = item.id;
        }
        return next;
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("studio.handover.failed"));
    } finally {
      setSending(false);
    }
  }, [requestId, t]);

  // Hand the videos over once, as soon as they are all made.
  useEffect(() => {
    if (tried.current || outputs.length === 0 || pending.length === 0) return;
    tried.current = true;
    void sendAll();
  }, [outputs.length, pending.length, sendAll]);

  if (outputs.length === 0) return null;

  return (
    <section className="studio-panel">
      <h2 className="studio-panel-title">{t("studio.handover.title")}</h2>
      <p className="studio-panel-hint">{t("studio.handover.hint")}</p>

      {sending && (
        <p className="studio-note studio-note-accent" aria-live="polite">
          <span className="studio-live-dot" aria-hidden /> {t("studio.handover.sending")}
        </p>
      )}
      {!sending && pending.length === 0 && (
        <p className="studio-note studio-note-positive">{t("studio.handover.sent")}</p>
      )}

      <ul className="studio-channel-list">
        {outputs.map((output) => {
          const contentId = transferred[output.assetId];
          return (
            <li key={output.assetId} className="studio-channel">
              <div className="studio-channel-head">
                <span className="studio-channel-label">
                  <strong>{output.ratio}</strong> {labelFor(output.ratio)}
                </span>
                {contentId ? (
                  <Link
                    href={managementPublishReturnPath(contentId)}
                    className="studio-button studio-button-primary"
                  >
                    {t("studio.handover.publish")}
                  </Link>
                ) : (
                  <span className="studio-shot-meta">{t("studio.handover.notSent")}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="studio-note studio-note-danger" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
      <div className="studio-approve">
        {pending.length > 0 && !sending && (
          <button
            type="button"
            className="studio-button studio-button-primary"
            onClick={() => void sendAll()}
          >
            {error ? t("studio.handover.retry") : t("studio.handover.send")}
          </button>
        )}
        <Link href={ROUTES.MANAGEMENT_CONNECTIONS} className="studio-button studio-button-ghost">
          {t("studio.handover.accounts")}
        </Link>
        <Link href={ROUTES.MANAGEMENT_POSTS} className="studio-button studio-button-ghost">
          {t("studio.handover.posts")}
        </Link>
      </div>
    </section>
  );
}

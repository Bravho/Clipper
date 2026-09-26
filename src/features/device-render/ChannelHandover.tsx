"use client";

import Link from "next/link";

import { ROUTES } from "@/config/routes";
import { managementArrivalPath } from "@/features/management/components/StudioTransferScreen";
import type { StudioOutput } from "./studioPipeline";
import { useStudioT } from "./studioI18n";

/** Channel Management as the studio page read it for this request. */
export interface StudioManagement {
  enabled: boolean;
  /** Finished video (export asset id) → its Channel Management item id. */
  transferredByAssetId: Record<string, string>;
}

/**
 * The studio's last stage: one button that takes the finished videos to
 * Channel Management.
 *
 * Tho, 26 Sep: the studio no longer runs its own "Publish to your channels"
 * block with Connected accounts / Posts and schedule links — publishing lives
 * in Channel Management, reached from the menu. What stays here is the
 * hand-over: the button opens `/dashboard/management/transfer`, which sends
 * each video (free, idempotent, with the caption the AI wrote for each
 * channel), shows a row per video as it goes, and then opens the library with
 * the new videos highlighted. Nothing is sent without the tap.
 *
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
  if (outputs.length === 0) return null;

  const transferred = management.transferredByAssetId;
  const pending = outputs.filter((output) => !transferred[output.assetId]);
  const sentIds = outputs
    .map((output) => transferred[output.assetId])
    .filter((id): id is string => Boolean(id));
  const transferPath = `${ROUTES.MANAGEMENT}/transfer?request=${encodeURIComponent(requestId)}`;

  return (
    <section className="studio-panel">
      <h2 className="studio-panel-title">{t("studio.handover.title")}</h2>
      <p className="studio-panel-hint">{t("studio.handover.hint")}</p>

      <ul className="studio-channel-list">
        {outputs.map((output) => (
          <li key={output.assetId} className="studio-channel">
            <div className="studio-channel-head">
              <span className="studio-channel-label">
                <strong>{output.ratio}</strong> {labelFor(output.ratio)}
              </span>
              <span className="studio-shot-meta">
                {transferred[output.assetId] ? t("studio.handover.inManagement") : t("studio.handover.notSent")}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="studio-approve">
        {pending.length > 0 ? (
          <Link href={transferPath} className="studio-button studio-button-primary">
            {t("studio.handover.send", { count: pending.length })}
          </Link>
        ) : (
          <Link href={managementArrivalPath(sentIds)} className="studio-button studio-button-primary">
            {t("studio.handover.open")}
          </Link>
        )}
        <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
          {pending.length > 0 ? t("studio.handover.sendHint") : t("studio.handover.sent")}
        </p>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";

import { ROUTES } from "@/config/routes";
import { usePricingHref } from "./usePricingHref";
import type { VideoAccessView } from "@/services/VideoAccessService";
import { managementArrivalPath } from "@/features/management/components/StudioTransferScreen";
import type { StudioOutput } from "./studioPipeline";
import { useStudioT } from "./studioI18n";
import { trackStudioAction } from "./studioTracker";

/** Channel Management as the studio page read it for this request. */
export interface StudioManagement {
  enabled: boolean;
  /** Finished video (export asset id) → its Channel Management item id. */
  transferredByAssetId: Record<string, string>;
}

/**
 * The studio's last stage: one button, "Migrate to Channel Management", that
 * takes the finished videos not yet there to Channel Management. Since
 * 2026-10-12 it needs a package: without one (or once the videos expired) the
 * button is off and says why.
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
  access = null,
}: {
  requestId: string;
  outputs: StudioOutput[];
  /** The channels a shape serves, for the per-video row. */
  labelFor: (ratio: string) => string;
  management: StudioManagement;
  /**
   * What the server allows for this request: sending needs a live package, an
   * unlocked request and unexpired videos (VideoAccessService). Null from an
   * older server, which decides on the transfer page instead.
   */
  access?: VideoAccessView | null;
}) {
  const t = useStudioT();
  const pricingHref = usePricingHref();
  if (outputs.length === 0) return null;

  const transferred = management.transferredByAssetId;
  const pending = outputs.filter((output) => !transferred[output.assetId]);
  const sentIds = outputs
    .map((output) => transferred[output.assetId])
    .filter((id): id is string => Boolean(id));
  const transferPath = `${ROUTES.MANAGEMENT}/transfer?request=${encodeURIComponent(requestId)}`;
  const blocked = access != null && !access.canSendToManagement ? access.transferBlock : null;

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

      {/* Tho, 27 Sep: ONE button, "Migrate to Channel Management". It moves the
          videos not there yet, so it can be pressed again after a skipped
          shape is made later, and that shape follows the others. With nothing
          left to move it is disabled — also when the originals are gone and
          every video made is already there. */}
      <div className="studio-approve">
        {blocked && (
          <div
            className={
              blocked === "expired"
                ? "studio-note studio-note-danger"
                : "studio-note studio-note-warning"
            }
            role="status"
          >
            <p style={{ margin: 0 }}>
              {blocked === "expired"
                ? t("studio.handover.expired")
                : t("studio.handover.needsPackage")}
            </p>
            {blocked === "package_required" && (
              <Link
                href={pricingHref}
                className="studio-button studio-button-primary"
                style={{ marginTop: 10 }}
              >
                {t("studio.access.seePackages")}
              </Link>
            )}
          </div>
        )}
        {pending.length > 0 && !blocked ? (
          <Link
            href={transferPath}
            className="studio-button studio-button-primary"
            onClick={() =>
              trackStudioAction("sent_to_management", requestId, { videos: pending.length })
            }
          >
            {t("studio.handover.migrate")}
          </Link>
        ) : (
          <button type="button" className="studio-button studio-button-primary" disabled>
            {t("studio.handover.migrate")}
          </button>
        )}
        <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
          {t("studio.handover.migrateHint")}
        </p>
        <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
          {pending.length > 0
            ? t("studio.handover.migrateCount", { count: pending.length })
            : t("studio.handover.allMigrated")}
        </p>
        {sentIds.length > 0 && (
          <Link href={managementArrivalPath(sentIds)} className="studio-button studio-button-ghost">
            {t("studio.handover.open")}
          </Link>
        )}
      </div>
    </section>
  );
}

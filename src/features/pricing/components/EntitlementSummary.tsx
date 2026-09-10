"use client";

import { Card } from "@/components/ui/Card";
import { useI18n } from "@/i18n/client";

/**
 * "What do I currently hold, and until when?"
 *
 * This sits directly under the credit balance because it answers the question
 * the balance provokes. A credit balance says what you can spend; it says
 * nothing about what you already bought. Before this, the only way to find out
 * whether your paid month was still running was to try to submit a request and
 * see whether you were refused.
 *
 * Dates arrive PRE-FORMATTED from the server. Formatting them here would run
 * `Intl` in the browser's locale and timezone rather than the app's, which is
 * the classic Next.js hydration mismatch — server renders a Thai Buddhist-era
 * date, client re-renders a Gregorian one, React discards the tree.
 *
 * Both rows deliberately state the extend-don't-replace rule, because the
 * natural fear when buying a second package while one is still running is that
 * the remaining time is thrown away.
 */

export interface VideoEntitlement {
  /** True when a purchased month is currently live. */
  paid: boolean;
  remaining: number;
  total: number;
  /** Formatted date the last purchased month lapses; null on the free tier. */
  activeUntil: string | null;
  /** Rolling window length for the free allowance. */
  freeWindowDays: number;
}

export interface ManagementEntitlement {
  /** "pass" = unlimited publishing window, "tokens" = upload bundle, "none". */
  kind: "pass" | "tokens" | "none";
  /** Formatted expiry for a live pass, or for the token bundle. */
  activeUntil: string | null;
  /** Upload tokens left, when `kind` is "tokens". */
  tokensRemaining: number;
}

interface Props {
  video: VideoEntitlement;
  /** Omitted entirely for users Channel Management is not enabled for. */
  management?: ManagementEntitlement | null;
}

function Row({
  label,
  value,
  detail,
  live,
}: {
  label: string;
  value: string;
  detail: string;
  live: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-2 w-2 flex-shrink-0 rounded-full ${
            live ? "bg-emerald-500" : "bg-slate-300"
          }`}
        />
        <span className="text-sm font-medium text-slate-900">{label}</span>
      </div>
      <div className="min-w-0 sm:text-right">
        <p className="text-sm font-semibold text-slate-900">{value}</p>
        <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

export function EntitlementSummary({ video, management }: Props) {
  const { t } = useI18n();

  const videoValue = video.paid
    ? t("pricing.status.videoPaid", {
        remaining: video.remaining,
        total: video.total,
      })
    : t("pricing.status.videoFree", {
        remaining: video.remaining,
        total: video.total,
        days: video.freeWindowDays,
      });

  const videoDetail = video.activeUntil
    ? t("pricing.status.until", { date: video.activeUntil })
    : t("pricing.status.noPaidVideo");

  const managementValue =
    management?.kind === "pass"
      ? t("pricing.status.publishingUnlimited")
      : management?.kind === "tokens"
        ? t("pricing.status.publishingTokens", {
            remaining: management.tokensRemaining,
          })
        : t("pricing.status.publishingNone");

  const managementDetail = management?.activeUntil
    ? t("pricing.status.until", { date: management.activeUntil })
    : t("pricing.status.noPublishing");

  return (
    <Card className="mb-8">
      <h2 className="text-sm font-semibold text-slate-900">
        {t("pricing.status.heading")}
      </h2>

      <div className="mt-1 divide-y divide-slate-100">
        <Row
          label={t("pricing.status.videoLabel")}
          value={videoValue}
          detail={videoDetail}
          live={video.paid}
        />
        {management && (
          <Row
            label={t("pricing.status.publishingLabel")}
            value={managementValue}
            detail={managementDetail}
            live={management.kind !== "none"}
          />
        )}
      </div>

      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {t("pricing.status.extendNote")}
      </p>
    </Card>
  );
}

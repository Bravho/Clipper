"use client";

import { Card } from "@/components/ui/Card";
import { useI18n } from "@/i18n/client";

/**
 * Everything this account has bought, newest first.
 *
 * WHY IT MATTERS BEYOND TIDINESS. Purchases here are irreversible credit debits
 * with no refund path, and packages STACK — buying while time is still running
 * extends it. Without a record, a user who is unsure whether a click went
 * through has exactly one way to find out: buy it again. This is the page that
 * stops that.
 *
 * Video purchases have no purchases table of their own; a purchase is the run of
 * `video_allowance_windows` rows sharing a `purchase_id`, and the page groups
 * them back into one row. Management purchases come from `management_purchases`.
 * Both are already merged and sorted by the server — this component only
 * renders, and the dates arrive pre-formatted to avoid a locale/timezone
 * hydration mismatch.
 */

export interface PurchaseHistoryRow {
  id: string;
  /** Pre-formatted purchase date. */
  date: string;
  /** Localised product name. */
  name: string;
  credits: number;
  /** Drives the small type chip. */
  kind: "video" | "publishing" | "bundle";
  /** Pre-formatted coverage, e.g. "until 12 Oct 2026". Optional. */
  coverage?: string | null;
}

const CHIP: Record<PurchaseHistoryRow["kind"], string> = {
  video: "bg-blue-50 text-blue-700",
  publishing: "bg-slate-100 text-slate-700",
  bundle: "bg-emerald-50 text-emerald-700",
};

export function PurchaseHistory({ rows }: { rows: PurchaseHistoryRow[] }) {
  const { t } = useI18n();

  const kindLabel: Record<PurchaseHistoryRow["kind"], string> = {
    video: t("pricing.history.kindVideo"),
    publishing: t("pricing.history.kindPublishing"),
    bundle: t("pricing.history.kindBundle"),
  };

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold text-slate-900">
        {t("pricing.history.heading")}
      </h2>
      <p className="mt-1 text-sm text-slate-500">{t("pricing.history.subheading")}</p>

      <Card className="mt-4">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            {t("pricing.history.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {row.name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHIP[row.kind]}`}
                    >
                      {kindLabel[row.kind]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.date}
                    {row.coverage ? ` · ${row.coverage}` : ""}
                  </p>
                </div>
                <p className="flex-shrink-0 text-sm font-semibold tabular-nums text-slate-900 sm:text-right">
                  {t("pricing.history.spent", {
                    credits: row.credits.toLocaleString(),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

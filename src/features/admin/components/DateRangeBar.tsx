"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import { RANGE_PRESETS, presetRangeQuery } from "@/features/admin/dateRange";

/**
 * Date-range control shared by the analytics pages.
 *
 * Presets are plain links rather than a client-side filter: the pages are
 * server components that read `searchParams`, so navigating IS the filter, and
 * the range survives a refresh, a bookmark, and being pasted to someone else.
 *
 * Filters sit in one row above the charts, per the chart layout convention.
 */
export function DateRangeBar({
  fromInput,
  toInput,
  days,
}: {
  fromInput: string;
  toInput: string;
  days: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A preset is "active" when the window length matches and it ends today —
  // comparing the query string directly would miss the default (no params).
  const todayQuery = (presetDays: number) => presetRangeQuery(presetDays);
  const isActive = (presetDays: number) => {
    const expected = new URLSearchParams(todayQuery(presetDays).slice(1));
    const current = searchParams?.get("to") ?? expected.get("to");
    return days === presetDays && current === expected.get("to");
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-1">
        {RANGE_PRESETS.map((preset) => (
          <Link
            key={preset.days}
            href={`${pathname}${presetRangeQuery(preset.days)}`}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm transition",
              isActive(preset.days)
                ? "bg-slate-100 font-medium text-slate-900"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            {preset.label}
          </Link>
        ))}
      </div>

      <form method="get" action={pathname} className="flex items-center gap-2">
        <input
          type="date"
          name="from"
          defaultValue={fromInput}
          aria-label="From date"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date"
          name="to"
          defaultValue={toInput}
          aria-label="To date"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
        />
        <button
          type="submit"
          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Apply
        </button>
      </form>
    </div>
  );
}

/**
 * Every analytics page states its window and its timezone.
 *
 * Worth the line: these reports bucket by Bangkok day, and a reader who assumes
 * UTC will misread the time-of-day charts by seven hours.
 */
export function RangeCaption({ days }: { days: number }) {
  return (
    <p className="text-xs text-slate-400">
      {days} day{days === 1 ? "" : "s"} · all dates and hours in Asia/Bangkok
    </p>
  );
}

import { sequentialStep } from "@/features/admin/charts/palette";

/** Sunday-first, matching Postgres `EXTRACT(DOW)` where Sunday = 0. */
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface HourCell {
  /** 0 = Sunday … 6 = Saturday, in Asia/Bangkok. */
  dayOfWeek: number;
  /** 0–23, in Asia/Bangkok. */
  hour: number;
  count: number;
}

/**
 * 7 × 24 day-of-week × hour-of-day heatmap.
 *
 * This is the arrival-rate profile the capacity model needs: the peak cell is
 * the busiest hour of the week, and that hour — not the daily average — is what
 * the render worker has to survive.
 *
 * Built from plain grid cells rather than a charting library. A heatmap is a
 * table of magnitudes, and as markup every cell can carry a `title` for hover
 * and an accessible label, which a canvas-rendered one cannot.
 *
 * Colour is the single-hue blue ramp (never a rainbow) with slate-100 reserved
 * for a true zero, so "no activity" is visibly different from "a little".
 * Because cell colour alone is below the contrast floor, the peak is also
 * stated in words beneath the grid.
 */
export function HourHeatmap({
  cells,
  emptyMessage = "No approvals recorded in this range.",
}: {
  cells: HourCell[];
  emptyMessage?: string;
}) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  let total = 0;

  for (const cell of cells) {
    if (cell.dayOfWeek < 0 || cell.dayOfWeek > 6) continue;
    if (cell.hour < 0 || cell.hour > 23) continue;
    grid[cell.dayOfWeek][cell.hour] = cell.count;
    if (cell.count > max) max = cell.count;
    total += cell.count;
  }

  if (total === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 px-6 text-center">
        <p className="max-w-sm text-xs text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  // Peak cell, named in words — the heatmap's headline.
  let peakDay = 0;
  let peakHour = 0;
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      if (grid[d][h] === max) {
        peakDay = d;
        peakHour = h;
      }
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[38rem]">
          {/* Hour ruler — every third hour, so the labels never collide. */}
          <div className="mb-1 flex pl-9">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="flex-1 text-center">
                {hour % 3 === 0 && (
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {hour}
                  </span>
                )}
              </div>
            ))}
          </div>

          {grid.map((row, day) => (
            <div key={day} className="mb-0.5 flex items-center">
              <span className="w-9 flex-shrink-0 pr-2 text-right text-[10px] text-slate-400">
                {DAY_LABELS[day]}
              </span>
              {row.map((count, hour) => (
                <div key={hour} className="flex-1 px-[1px]">
                  <div
                    className="h-5 rounded-sm"
                    style={{ backgroundColor: sequentialStep(count, max) }}
                    title={`${DAY_LABELS[day]} ${String(hour).padStart(2, "0")}:00 — ${count} approval${count === 1 ? "" : "s"}`}
                    aria-label={`${DAY_LABELS[day]} ${hour}:00, ${count} approvals`}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Peak:{" "}
          <span className="font-medium text-slate-800">
            {DAY_LABELS[peakDay]} {String(peakHour).padStart(2, "0")}:00–
            {String((peakHour + 1) % 24).padStart(2, "0")}:00
          </span>{" "}
          with {max.toLocaleString()} approval{max === 1 ? "" : "s"} ·{" "}
          {total.toLocaleString()} total
        </p>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400">0</span>
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((fraction) => (
            <span
              key={fraction}
              className="h-3 w-4 rounded-sm"
              style={{ backgroundColor: sequentialStep(fraction * max, max) }}
            />
          ))}
          <span className="text-[10px] tabular-nums text-slate-400">{max}</span>
        </div>
      </div>
    </div>
  );
}

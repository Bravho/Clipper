import type { ReactNode } from "react";

/**
 * Card wrapper shared by every admin chart.
 *
 * Keeps the surface, heading scale and spacing identical across the analytics
 * pages, and gives each chart a slot for the "relief" the palette requires —
 * `footnote` is where the table link or the caveat about the data goes.
 *
 * Server component: it renders no interactive chrome of its own, so pages can
 * use it directly and only the chart inside needs to be a client component.
 */
export function ChartFrame({
  title,
  description,
  action,
  footnote,
  children,
}: {
  title: string;
  description?: string;
  /** Optional control rendered at the top right (a link, a toggle). */
  action?: ReactNode;
  /** Caveats, units, or a pointer to the table showing the same numbers. */
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>

      {children}

      {footnote && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
          {footnote}
        </p>
      )}
    </section>
  );
}

/**
 * "No data yet" placeholder, sized like a chart so the page does not jump.
 *
 * Several of these pages read tables that only start filling after the
 * instrumentation ships, so an empty state that explains WHY is worth more than
 * an empty axis.
 */
export function ChartEmpty({
  message,
  height = 240,
}: {
  message: string;
  height?: number;
}) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 px-6 text-center"
      style={{ height }}
    >
      <p className="max-w-sm text-xs text-slate-500">{message}</p>
    </div>
  );
}

/**
 * Duration formatting, in a module with NO server imports.
 *
 * This lives apart from `AdminPipelineMetricsService` — which owns the canonical
 * implementation's behaviour but also imports the `pg` pool — because the chart
 * components are client components. Importing the service from one would drag
 * `pg` into the browser bundle. `AdminPipelineMetricsService` re-exports these,
 * so there is still exactly one implementation.
 */

/** `1.4s` · `47s` · `2m 30s` · `1h 12m`. Never raw milliseconds. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
  }
  const hours = Math.floor(seconds / 3600);
  return `${hours}h ${Math.round((seconds - hours * 3600) / 60)}m`;
}

/**
 * How a chart should render its numbers.
 *
 * A plain string, deliberately — NOT a formatter function. A server component
 * cannot pass a function across the RSC boundary to a client component ("Functions
 * cannot be passed directly to Client Components"), and every admin analytics page
 * is a server component. Naming the format and resolving it on the client side is
 * what keeps these charts usable from a server page at all.
 */
export type ValueFormat = "number" | "duration" | "percent";

/** Resolve a `ValueFormat` name to the actual formatting. */
export function formatChartValue(value: number, format: ValueFormat = "number"): string {
  switch (format) {
    case "duration":
      return formatDuration(value);
    case "percent":
      return `${Math.round(value)}%`;
    case "number":
    default:
      return value.toLocaleString();
  }
}

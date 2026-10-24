import type { LatestStep } from "@/services/admin/AdminRequestJourneyService";
import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";

/** Colour by how far along the journey the request is. */
function tone(rank: number, failed: boolean): string {
  if (failed) return "bg-red-100 text-red-700";
  if (rank >= 10) return "bg-emerald-100 text-emerald-700"; // downloaded / CM / published
  if (rank >= 7) return "bg-green-100 text-green-700"; // rendered and beyond
  if (rank >= 4) return "bg-indigo-100 text-indigo-700"; // voice
  if (rank >= 2) return "bg-blue-100 text-blue-700"; // storyboard
  return "bg-slate-100 text-slate-600";
}

/**
 * The furthest studio step a request reached (AdminRequestJourneyService),
 * with when it got there in the tooltip and a red mark when the pipeline
 * stopped on an error.
 */
export function StudioStepBadge({ step }: { step: LatestStep }) {
  const when = step.at
    ? step.at.toLocaleString("en-GB", {
        timeZone: REPORTING_TIMEZONE,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " (UTC+7)"
    : "time not recorded";
  const title = step.failed
    ? `${step.label} — ${when}. Pipeline failed${step.failedAtStep ? ` at ${step.failedAtStep}` : ""}.`
    : `${step.label} — ${when}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone(step.rank, step.failed)}`}
    >
      {step.label}
      {step.failed && <span aria-label="failed">· failed</span>}
    </span>
  );
}

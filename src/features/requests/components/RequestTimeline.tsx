import type { TimelineEntry } from "@/services/RequestPresentationService";

interface RequestTimelineProps {
  entries: TimelineEntry[];
}

/**
 * Simplified status timeline for requesters. Shows a chronological list of
 * milestones — both request-level status changes and the AI production
 * pipeline phases the request has passed through (built by
 * `requestPresentationService.buildStatusTimeline`).
 */
export function RequestTimeline({ entries }: RequestTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-400">No status history available.</p>
    );
  }

  return (
    <ol className="relative border-l border-slate-200 pl-4 flex flex-col gap-4">
      {entries.map((entry, idx) => {
        const isLatest = idx === entries.length - 1;

        return (
          <li key={entry.id} className="relative">
            {/* Timeline dot */}
            <span
              className={`absolute -left-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
                isLatest ? "bg-blue-600" : "bg-slate-300"
              }`}
            />
            <div>
              <p className="text-sm font-medium text-slate-800">
                {entry.label}
              </p>
              <p className="text-xs text-slate-400">
                {entry.changedAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

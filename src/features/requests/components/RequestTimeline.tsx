import { RequestStatusHistory } from "@/domain/models/RequestStatusHistory";
import { requestPresentationService } from "@/services/RequestPresentationService";

interface RequestTimelineProps {
  history: RequestStatusHistory[];
}

/**
 * Simplified status timeline for requesters.
 * Shows a chronological list of status changes.
 * Internal staff notes are shown only where relevant to the requester
 * (e.g., hold reasons).
 */
export function RequestTimeline({ history }: RequestTimelineProps) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-slate-400">No status history available.</p>
    );
  }

  return (
    <ol className="relative border-l border-slate-200 pl-4 flex flex-col gap-4">
      {history.map((entry, idx) => {
        const presentation = requestPresentationService.getStatusPresentation(
          entry.status
        );
        const isLatest = idx === history.length - 1;

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
                {presentation.label}
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

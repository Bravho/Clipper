import { DueDateDisplay as DueDateDisplayType } from "@/services/RequestPresentationService";

interface DueDateDisplayProps {
  display: DueDateDisplayType;
  className?: string;
}

/**
 * Renders the requester-facing due date area.
 * Adapts to the DueDateDisplay view-model from RequestPresentationService.
 *
 * - If show=false: renders nothing.
 * - If confirmed date: shows date prominently.
 * - If pending: shows a gentle pending message.
 */
export function DueDateDisplay({ display, className }: DueDateDisplayProps) {
  if (!display.show) return null;

  return (
    <div className={className}>
      {display.formattedDate ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Expected Completion
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">
            {display.formattedDate}
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500 italic">{display.message}</p>
      )}
    </div>
  );
}

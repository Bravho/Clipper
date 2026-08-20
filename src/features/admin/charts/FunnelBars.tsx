import { SEQUENTIAL_BLUE } from "@/features/admin/charts/palette";

export interface FunnelStage {
  label: string;
  /** Distinct users who reached this stage. */
  users: number;
  /** Optional secondary count (events, not people). */
  events?: number;
  /** Short note explaining how the stage is counted. */
  hint?: string;
}

/**
 * Conversion funnel as proportional horizontal bars.
 *
 * Plain markup rather than a charting library: a funnel is a list of labelled
 * magnitudes, and expressing it as HTML means every number is real text — which
 * is exactly the "relief" the palette's contrast warning requires, and it stays
 * readable when the widest stage is 4,000 and the narrowest is 3.
 *
 * The bars use the ORDINAL blue ramp (nothing lighter than 2:1 against white),
 * darkening down the funnel so depth reads even in greyscale. Width is scaled to
 * the FIRST stage, not to the maximum, so a later stage can never look wider
 * than the population it came from.
 *
 * Server component — no interactivity, so it costs nothing on the client.
 */
export function FunnelBars({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.users ?? 0;
  const ramp = SEQUENTIAL_BLUE.ordinal;

  return (
    <ol className="space-y-3">
      {stages.map((stage, index) => {
        const previous = index > 0 ? stages[index - 1].users : null;
        const widthPct = top > 0 ? Math.max((stage.users / top) * 100, 0.6) : 0;
        const ofTop = top > 0 ? (stage.users / top) * 100 : 0;
        const ofPrevious =
          previous && previous > 0 ? (stage.users / previous) * 100 : null;
        // Biggest single drop is worth calling out — it is the one to act on.
        const dropped = previous !== null ? previous - stage.users : 0;

        return (
          <li key={stage.label}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-slate-800">
                <span className="mr-2 text-xs tabular-nums text-slate-400">
                  {index + 1}
                </span>
                {stage.label}
              </p>
              <p className="flex-shrink-0 text-sm tabular-nums text-slate-900">
                <span className="font-semibold">{stage.users.toLocaleString()}</span>
                <span className="ml-1 text-xs text-slate-400">
                  user{stage.users === 1 ? "" : "s"}
                </span>
                {typeof stage.events === "number" && (
                  <span className="ml-2 text-xs text-slate-400">
                    / {stage.events.toLocaleString()} total
                  </span>
                )}
              </p>
            </div>

            <div className="mt-1.5 h-4 w-full overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded-r"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: ramp[Math.min(index, ramp.length - 1)],
                }}
              />
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
              <span className="tabular-nums">{ofTop.toFixed(1)}% of stage 1</span>
              {ofPrevious !== null && (
                <span className="tabular-nums">
                  {ofPrevious.toFixed(1)}% of previous
                </span>
              )}
              {dropped > 0 && (
                <span className="tabular-nums text-slate-500">
                  −{dropped.toLocaleString()} dropped here
                </span>
              )}
              {stage.hint && <span className="italic">{stage.hint}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

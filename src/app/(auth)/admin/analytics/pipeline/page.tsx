import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { parseDateRange } from "@/features/admin/dateRange";
import { DateRangeBar, RangeCaption } from "@/features/admin/components/DateRangeBar";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";
import { ChartEmpty, ChartFrame } from "@/features/admin/charts/ChartFrame";
import { GroupedBarChart } from "@/features/admin/charts/GroupedBarChart";
import { adminDashboardService } from "@/services/admin/AdminDashboardService";
import {
  adminPipelineMetricsService,
  formatDuration,
  humaniseStep,
  summariseQueue,
} from "@/services/admin/AdminPipelineMetricsService";
import type {
  DurationStats,
  PipelineStepStats,
} from "@/services/admin/AdminPipelineMetricsService";
import { attempt } from "@/features/admin/attempt";
import type { AttemptError } from "@/features/admin/attempt";
import { AdminErrorPanel } from "@/features/admin/components/AdminErrorPanel";

export const metadata: Metadata = { title: "Pipeline Timing — Admin" };

/**
 * Where the time goes in video generation.
 *
 * Two questions, kept apart everywhere on this page because conflating them
 * sends you off fixing the wrong thing:
 *
 *   WAIT — how long a step sat before anything picked it up. Long waits mean
 *          the single Mac Mini worker is saturated. Buy capacity.
 *   RUN  — how long the step then took. Long runs mean the step itself is
 *          expensive. Optimise the render.
 *
 * And two populations, also kept apart: queue-backed render steps (section A,
 * measured precisely) and every pipeline step including the inline AI calls
 * (section B, measured from step-history gaps). Section D counts the work that
 * appears in neither, which is the largest known hole in this data.
 */
export default async function AdminPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  await requireRole(Role.Admin);

  const params = await searchParams;
  const range = parseDateRange(params);

  // Caught per section. These five queries read different tables with different
  // shape hazards, so one failing should cost one section — and in production a
  // thrown error becomes an opaque digest, which is no use to whoever has to fix
  // it. See `attempt()`.
  const [
    renderStepsAttempt,
    pipelineStepsAttempt,
    inlineFallbacksAttempt,
    stalledAttempt,
    queueSnapshotAttempt,
  ] = await Promise.all([
    attempt(() => adminPipelineMetricsService.getRenderStepStats(range.from, range.to), "Render step stats"),
    attempt(() => adminPipelineMetricsService.getPipelineStepStats(range.from, range.to), "Pipeline step stats"),
    attempt(() => adminPipelineMetricsService.getInlineFallbacks(range.from, range.to), "Inline fallback count"),
    attempt(() => adminPipelineMetricsService.getStalledJobs(), "Stalled jobs"),
    attempt(() => adminDashboardService.getRenderQueueSnapshot(), "Live render queue"),
  ]);

  const failures = [
    renderStepsAttempt,
    pipelineStepsAttempt,
    inlineFallbacksAttempt,
    stalledAttempt,
    queueSnapshotAttempt,
  ].filter((a) => !a.ok) as { ok: false; error: AttemptError }[];

  const renderSteps = renderStepsAttempt.ok ? renderStepsAttempt.data : [];
  const pipelineSteps = pipelineStepsAttempt.ok ? pipelineStepsAttempt.data : [];
  const inlineFallbacks = inlineFallbacksAttempt.ok
    ? inlineFallbacksAttempt.data
    : { rows: [], totalTransitions: 0, totalInline: 0, inlineSharePct: 0 };
  const stalled = stalledAttempt.ok ? stalledAttempt.data : [];
  const queueSnapshot = queueSnapshotAttempt.ok
    ? queueSnapshotAttempt.data
    : { workerOnline: false, tasks: [] };

  const queue = summariseQueue(queueSnapshot);

  const computeSteps = pipelineSteps.filter((step) => !step.isGate);
  const gateSteps = pipelineSteps.filter((step) => step.isGate);

  // Median, not mean: one interrupted render whose "wait" spans an hour-long
  // restart would otherwise dominate every bar on the chart.
  const waitVsRun = renderSteps
    .filter((step) => step.wait.median !== null || step.run.median !== null)
    .map((step) => ({
      category: humaniseStep(step.step),
      wait: Math.round(step.wait.median ?? 0),
      run: Math.round(step.run.median ?? 0),
    }));

  const slowestRun = [...renderSteps].sort(
    (a, b) => (b.run.median ?? 0) - (a.run.median ?? 0)
  )[0];
  const longestWait = [...renderSteps].sort(
    (a, b) => (b.wait.median ?? 0) - (a.wait.median ?? 0)
  )[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pipeline Timing</h1>
        <p className="mt-1 text-sm text-slate-500">
          How long each step waits to be picked up, and how long it then takes.
        </p>
      </div>

      <DateRangeBar
        fromInput={range.fromInput}
        toInput={range.toInput}
        days={range.days}
      />

      {failures.map((failure, i) => (
        <AdminErrorPanel
          key={i}
          title="A section of this page failed to load"
          error={failure.error}
        />
      ))}
      <RangeCaption days={range.days} />

      {/* ── C. Live state ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Right now
        </h2>
        <StatTileGrid>
          <StatTile
            label="Render worker"
            value={queue.workerOnline ? "Online" : "Offline"}
            hint={
              queue.workerOnline
                ? "heartbeat is fresh — heavy steps are being offloaded"
                : "heavy steps are running inline on the web server"
            }
            tone={queue.workerOnline ? "good" : "urgent"}
          />
          <StatTile
            label="Waiting in the queue"
            value={queue.queued}
            hint="tasks enqueued and not yet claimed"
          />
          <StatTile
            label="Rendering now"
            value={queue.claimed}
            hint="claimed by a worker"
          />
          <StatTile
            label="Oldest task waiting"
            value={formatDuration(queue.oldestWaitingMs)}
            hint={
              queue.oldestWaitingStep
                ? humaniseStep(queue.oldestWaitingStep)
                : "nothing is waiting"
            }
          />
        </StatTileGrid>
        <p className="mt-2 text-xs text-slate-400">
          Live figures, not filtered by the date range. &ldquo;Oldest task
          waiting&rdquo; looks only at unclaimed tasks — a long render in progress is
          work being done, not a backlog.
        </p>
      </section>

      {/* ── D. The hole in the data ─────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Work the queue never saw
        </h2>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            {inlineFallbacks.totalInline.toLocaleString()} heavy step
            {inlineFallbacks.totalInline === 1 ? "" : "s"} ran inline on the web
            server ({percent(inlineFallbacks.inlineSharePct)} of{" "}
            {inlineFallbacks.totalTransitions.toLocaleString()} in range)
          </p>
          <p className="mt-1">
            When no worker heartbeat is fresh, dispatch falls back to running the
            render on the droplet itself — and writes <strong>no queue row at
            all</strong>. Those runs consumed CPU on the web server, competed with
            request handling, and are <strong>completely absent</strong> from the
            wait and run figures in the next section. This is the largest known gap
            in the timing data on this page.
          </p>
          <p className="mt-1">
            The count is a <strong>lower bound</strong>. It asks whether a job ever
            enqueued a given step, which cannot be matched to a specific attempt
            (see the caveats below), so a job that ran the step on the worker once
            and inline once is counted as fully queued.
          </p>
        </div>

        <div className="mt-3">
          {inlineFallbacks.rows.length === 0 ? (
            <EmptyRow message="No heavy pipeline steps were entered in this range." />
          ) : (
            <Table headers={["Pipeline step", "Transitions", "Ran inline", "Share"]}>
              {inlineFallbacks.rows.map((row) => (
                <tr key={row.step} className="hover:bg-slate-50">
                  <StepCell step={row.step} />
                  <Count value={row.transitions} />
                  <Count value={row.inline} />
                  <Pct
                    value={
                      row.transitions > 0 ? (row.inline / row.transitions) * 100 : 0
                    }
                  />
                </tr>
              ))}
            </Table>
          )}
        </div>
      </section>

      {/* ── A. Per render step ──────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Render queue, per step
        </h2>

        <StatTileGrid>
          <StatTile
            label="Slowest step to run"
            value={slowestRun ? formatDuration(slowestRun.run.median) : "—"}
            hint={
              slowestRun
                ? `${humaniseStep(slowestRun.step)} · median of ${slowestRun.finished.toLocaleString()} finished`
                : "no finished tasks in range"
            }
          />
          <StatTile
            label="Longest step to start"
            value={longestWait ? formatDuration(longestWait.wait.median) : "—"}
            hint={
              longestWait
                ? `${humaniseStep(longestWait.step)} · median queue wait`
                : "no claimed tasks in range"
            }
          />
          <StatTile
            label="Tasks enqueued"
            value={renderSteps.reduce((sum, step) => sum + step.total, 0)}
            hint="by enqueued_at, which the upsert resets — see the caveats"
          />
          <StatTile
            label="Failed"
            value={renderSteps.reduce((sum, step) => sum + step.failed, 0)}
            hint="tasks left in state failed"
            tone="urgent"
          />
        </StatTileGrid>

        <div className="mt-6 space-y-6">
          <ChartFrame
            title="Median wait versus median run, per step"
            description="Wait is queue pressure. Run is the cost of the step itself. They are different problems."
            footnote={
              <>
                Medians, because a single interrupted render distorts a mean beyond
                use. Every value here also appears in the table below, with the mean,
                p90 and maximum beside it.
              </>
            }
          >
            {waitVsRun.length === 0 ? (
              <ChartEmpty message="No render tasks were enqueued in this range. If generation was running, the worker was offline and the steps ran inline — see the section above." />
            ) : (
              <GroupedBarChart
                data={waitVsRun}
                series={[
                  { key: "wait", label: "Median queue wait" },
                  { key: "run", label: "Median run time" },
                ]}
                valueFormat="duration"
              />
            )}
          </ChartFrame>

          {renderSteps.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3" rowSpan={2}>
                      Step
                    </th>
                    <th className="px-4 py-3 text-right" rowSpan={2}>
                      Tasks
                    </th>
                    <th className="border-l border-slate-200 px-4 py-3 text-center" colSpan={4}>
                      Queue wait
                    </th>
                    <th className="border-l border-slate-200 px-4 py-3 text-center" colSpan={4}>
                      Run time
                    </th>
                    <th className="border-l border-slate-200 px-4 py-3 text-right" rowSpan={2}>
                      Attempts
                    </th>
                    <th className="px-4 py-3 text-right" rowSpan={2}>
                      Failure rate
                    </th>
                  </tr>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="border-l border-slate-200 px-4 py-3 text-right">Mean</th>
                    <th className="px-4 py-3 text-right">Median</th>
                    <th className="px-4 py-3 text-right">p90</th>
                    <th className="px-4 py-3 text-right">Max</th>
                    <th className="border-l border-slate-200 px-4 py-3 text-right">Mean</th>
                    <th className="px-4 py-3 text-right">Median</th>
                    <th className="px-4 py-3 text-right">p90</th>
                    <th className="px-4 py-3 text-right">Max</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {renderSteps.map((step) => (
                    <tr key={step.step} className="hover:bg-slate-50">
                      <StepCell step={step.step} />
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {step.total.toLocaleString()}
                        <span className="ml-1 text-xs text-slate-400">
                          {step.claimed.toLocaleString()} claimed ·{" "}
                          {step.finished.toLocaleString()} timed
                        </span>
                      </td>
                      <DurationCells stats={step.wait} bordered />
                      <DurationCells stats={step.run} bordered />
                      <td className="border-l border-slate-200 px-4 py-3 text-right tabular-nums text-slate-700">
                        {step.avgAttempts.toFixed(2)}
                      </td>
                      <Pct value={step.failureRatePct} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stated on the page, not only in the code: the reader of a printed
            screenshot has no access to the comments in the service. */}
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Two things these numbers cannot tell you</p>
          <p className="mt-1">
            <strong>Last attempt only.</strong> Re-dispatching a step upserts the
            job&rsquo;s existing queue row (<code>ON CONFLICT … DO UPDATE</code>),
            which resets <code>enqueued_at</code>, <code>attempts</code> and{" "}
            <code>duration_ms</code>. Every figure above therefore describes the{" "}
            <em>last</em> attempt of each step. Earlier attempts of a retried step
            leave no trace, so retries are undercounted and the true total time spent
            is higher than shown.
          </p>
          <p className="mt-1">
            <strong>Interruptions land in the wait column.</strong> Releasing a claim
            (worker restart, drain, crash reclaim) preserves the original{" "}
            <code>enqueued_at</code>, so the wait of an interrupted step spans the
            entire interruption. A worker that was down for an hour produces an
            hour-long &ldquo;queue wait&rdquo; that was never queue pressure — which
            is why the chart above plots medians.
          </p>
        </div>
      </section>

      {/* ── B. Per pipeline step ────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Every pipeline step, including the AI calls
        </h2>
        <p className="mb-3 text-xs text-slate-400">
          Measured as the gap to the next <em>different</em> step in the job&rsquo;s
          history. This is the only way to time <code>analyzing_content</code>,{" "}
          <code>generating_voice</code> and <code>generating_scene_design</code>:
          they call ChatGPT, iAppTTS and Gemini inline on the web server and never
          touch the render queue. Consecutive duplicate rows are collapsed first —
          the history write fires whenever an update carries the current step, not
          only when it changes, so the raw gaps would be write intervals rather than
          step durations.
        </p>

        {computeSteps.length === 0 ? (
          <EmptyRow message="No pipeline step transitions in this range." />
        ) : (
          <Table headers={["Step", "Samples", "Mean", "Median", "p90", "Max"]}>
            {computeSteps.map((step) => (
              <DwellRow key={step.step} step={step} />
            ))}
          </Table>
        )}

        <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Review gates (requester thinking time)
        </h3>
        {gateSteps.length === 0 ? (
          <EmptyRow message="No review gates were entered in this range." />
        ) : (
          <Table headers={["Gate", "Samples", "Mean", "Median", "p90", "Max"]}>
            {gateSteps.map((step) => (
              <DwellRow key={step.step} step={step} />
            ))}
          </Table>
        )}
        <p className="mt-2 text-xs text-slate-400">
          The gates are listed separately on purpose. An <code>awaiting_*</code> step
          is waiting for a <em>person</em>, and one requester approving overnight
          would swamp every render on the page if the two were averaged together.
          Read gate dwell as a product number (how hard is it to answer this
          question), never as a machine number.
        </p>
      </section>

      {/* ── E. Stall watch ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Stall watch
        </h2>
        {stalled.length === 0 ? (
          <EmptyRow message="No job is sitting on a processing step past its threshold." />
        ) : (
          <Table
            headers={["Request", "Step", "On this step for", "Threshold", "Worker"]}
            textColumns={[4]}
          >
            {stalled.map((job) => (
              <tr key={job.jobId} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">
                    {job.requestTitle ?? "(request deleted)"}
                  </p>
                  <p className="font-mono text-xs text-slate-400">{job.requestId}</p>
                </td>
                <StepCell step={job.step} />
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  {formatDuration(job.stalledForMs)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                  {formatDuration(job.thresholdMs)}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {job.workerActive
                    ? "rendering — keep-alive is fresh"
                    : "no live claim"}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-xs text-slate-400">
          Live, not filtered by the date range. Thresholds are the per-step windows
          in <code>src/config/stallThresholds.ts</code>, reused as-is — they are
          deliberately generous, so crossing one is a prompt to look, not a failure.
          A row marked <em>rendering</em> has a worker holding it with a fresh
          keep-alive and is very likely just slow; a row with <em>no live claim</em>{" "}
          either ran inline or lost its worker.
        </p>
      </section>
    </div>
  );
}

// ─── Presentation helpers ────────────────────────────────────────────────────

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Raw step name plus an English gloss — the raw value is what logs are grepped for. */
function StepCell({ step }: { step: string }) {
  return (
    <td className="px-4 py-3">
      <p className="font-medium text-slate-900">{humaniseStep(step)}</p>
      <p className="font-mono text-xs text-slate-400">{step}</p>
    </td>
  );
}

/** Mean / median / p90 / max as four right-aligned duration cells. */
function DurationCells({
  stats,
  bordered = false,
}: {
  stats: DurationStats;
  bordered?: boolean;
}) {
  const cell = "px-4 py-3 text-right tabular-nums text-slate-700";
  return (
    <>
      <td className={bordered ? `border-l border-slate-200 ${cell}` : cell}>
        {formatDuration(stats.mean)}
      </td>
      <td className={cell}>{formatDuration(stats.median)}</td>
      <td className={cell}>{formatDuration(stats.p90)}</td>
      <td className={cell}>{formatDuration(stats.max)}</td>
    </>
  );
}

function DwellRow({ step }: { step: PipelineStepStats }) {
  return (
    <tr className="hover:bg-slate-50">
      <StepCell step={step.step} />
      <Count value={step.samples} />
      <DurationCells stats={step.dwell} />
    </tr>
  );
}

function Table({
  headers,
  textColumns = [],
  children,
}: {
  headers: string[];
  /** Indexes that hold prose rather than numbers, so they stay left-aligned. */
  textColumns?: number[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            {headers.map((header, i) => (
              <th
                key={header}
                className={
                  i === 0 || textColumns.includes(i)
                    ? "px-4 py-3"
                    : "px-4 py-3 text-right"
                }
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

/** Right-aligned integer cell. `tabular-nums` keeps the column edges straight. */
function Count({ value }: { value: number }) {
  return (
    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
      {value.toLocaleString()}
    </td>
  );
}

function Pct({ value }: { value: number }) {
  return (
    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
      {percent(value)}
    </td>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-500">
      {message}
    </div>
  );
}

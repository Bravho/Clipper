import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { parseDateRange } from "@/features/admin/dateRange";
import { DateRangeBar, RangeCaption } from "@/features/admin/components/DateRangeBar";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";
import { ChartEmpty, ChartFrame } from "@/features/admin/charts/ChartFrame";
import { TimeSeriesChart } from "@/features/admin/charts/TimeSeriesChart";
import { FeedbackTriageButtons } from "@/features/admin/components/FeedbackTriageButtons";
import {
  adminFeedbackService,
  type FeedbackReport,
  type FeedbackReportStatus,
  type FeedbackReportType,
} from "@/services/admin/AdminFeedbackService";
import {
  parseReasonFilter,
  parseReportType,
  parseStatusFilter,
} from "@/features/admin/validation/feedbackSchemas";

export const metadata: Metadata = { title: "Feedback & Reports — Admin" };

/**
 * Feedback and AI-content report triage.
 *
 * `ai_content_reports` had no reader at all until this page: every star rating
 * and every safety report a user has ever submitted went into a table with no
 * screen behind it. The two tabs are the two things the table holds, and they
 * are read by different people for different reasons — product quality on one
 * side, app-store content-reporting compliance on the other — so they get
 * separate views rather than a mixed list with a type column.
 *
 * Tabs and filters are LINKS, not client state: the page is a server component
 * that reads `searchParams`, so navigating is the filter, and a triage queue
 * view can be bookmarked or pasted to the admin who owns it.
 */

/**
 * English labels for the sixteen `reason` values.
 *
 * The submit form (`ReportAiContent`) shows these in Thai to requesters; this
 * surface is English. The translations are meaning-for-meaning rather than
 * literal, and the raw enum value is always rendered next to the label so an
 * admin reading a row can match it to the constraint, the SQL and the ticket.
 */
const REASON_LABELS: Record<string, string> = {
  // report_type = 'feedback' — "what should we improve?"
  video_quality: "Overall video quality",
  scene_selection: "Image / scene selection",
  motion_direction: "Motion or camera direction",
  audio_music: "Voice-over or music",
  subtitles: "Subtitles",
  aspect_ratio: "Aspect ratio for the channel",
  other_feedback: "Other feedback",
  // report_type = 'safety' — the policy-required reporting reasons.
  unsafe: "Unsafe or inappropriate content",
  sexual: "Sexual content",
  violent: "Violence",
  hate: "Hate or harassment",
  privacy: "Privacy violation",
  impersonation: "Impersonation of a person or voice",
  copyright: "Copyright or trademark",
  misleading: "Misleading information",
  other: "Other",
};

/**
 * Status pill wording.
 *
 * "In Progress" and "Solved" are the words the triage buttons use; the stored
 * values (`reviewing`, `resolved`) are not shown, because a pill reading
 * "reviewing" next to a button reading "Mark solved" makes the reader work out
 * that they are the same lifecycle.
 */
const STATUS_PILLS: Record<FeedbackReportStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  reviewing: { label: "In Progress", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  resolved: { label: "Solved", className: "bg-green-50 text-green-700 ring-green-200" },
  dismissed: { label: "Dismissed", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

const STATUS_FILTERS: { value: FeedbackReportStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "reviewing", label: "In Progress" },
  { value: "resolved", label: "Solved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

const TABS: { value: FeedbackReportType; label: string; blurb: string }[] = [
  {
    value: "feedback",
    label: "Product feedback",
    blurb: "Star ratings and improvement notes from the final review step.",
  },
  {
    value: "safety",
    label: "Content reports (safety)",
    blurb:
      "Policy-required AI content reports. Google Play and the App Store both require these to be reviewed and actioned.",
  },
];

/** How many rows one page of the queue shows. */
const PAGE_SIZE = 200;

interface FeedbackSearchParams {
  type?: string | string[];
  status?: string | string[];
  reason?: string | string[];
  from?: string | string[];
  to?: string | string[];
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<FeedbackSearchParams>;
}) {
  await requireRole(Role.Admin);

  const query = await searchParams;
  const range = parseDateRange(query);
  const reportType = parseReportType(query.type);
  const status = parseStatusFilter(query.status);
  const reason = parseReasonFilter(query.reason);

  const rangeFilters = { from: range.from, to: range.to };

  const [reports, summary, typeCounts] = await Promise.all([
    adminFeedbackService.listReports({
      ...rangeFilters,
      reportType,
      status,
      reason,
      limit: PAGE_SIZE,
    }),
    adminFeedbackService.getSummary({ ...rangeFilters, reportType, reason }),
    // Tab counts follow the status filter, so switching tabs while looking at
    // the open queue answers "how many OPEN safety reports", not "how many ever".
    adminFeedbackService.getTypeCounts({ ...rangeFilters, status, reason }),
  ]);

  /** Preserve every other filter when one of them changes. */
  const linkTo = (overrides: Partial<Record<string, string>>) => {
    const params = new URLSearchParams({
      type: reportType,
      status,
      from: range.fromInput,
      to: range.toInput,
    });
    if (reason) params.set("reason", reason);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    return `/admin/feedback?${params.toString()}`;
  };

  const activeTab = TABS.find((tab) => tab.value === reportType)!;
  const isFeedbackTab = reportType === "feedback";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Feedback &amp; Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          What requesters said about their finished videos, and what they reported as unsafe.
        </p>
      </div>

      {/* Tabs. Links rather than client state — see the file header. */}
      <div>
        <nav className="flex flex-wrap gap-2 border-b border-slate-200" aria-label="Report type">
          {TABS.map((tab) => (
            <Link
              key={tab.value}
              href={linkTo({ type: tab.value })}
              aria-current={tab.value === reportType ? "page" : undefined}
              className={clsx(
                "-mb-px border-b-2 px-3 py-2 text-sm transition",
                tab.value === reportType
                  ? "border-slate-900 font-semibold text-slate-900"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              )}
            >
              {tab.label}
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {typeCounts[tab.value]}
              </span>
            </Link>
          ))}
        </nav>
        <p className="mt-2 text-xs text-slate-500">{activeTab.blurb}</p>
      </div>

      <DateRangeBar fromInput={range.fromInput} toInput={range.toInput} days={range.days} />

      {/* Status filter. Defaults to `open` — triage starts at the backlog. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Status
        </span>
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={linkTo({ status: filter.value })}
            aria-current={filter.value === status ? "page" : undefined}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm transition",
              filter.value === status
                ? "bg-slate-100 font-medium text-slate-900"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            {filter.label}
            {filter.value !== "all" && (
              <span className="ml-1.5 text-xs text-slate-400">
                {summary.byStatus[filter.value]}
              </span>
            )}
          </Link>
        ))}
        {reason && (
          <Link
            href={linkTo({ reason: undefined })}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
          >
            Reason: {REASON_LABELS[reason] ?? reason} ✕
          </Link>
        )}
        <RangeCaption days={range.days} />
      </div>

      <StatTileGrid>
        <StatTile
          label="Open"
          value={summary.byStatus.open}
          hint="Nobody has picked these up yet"
          tone="urgent"
        />
        <StatTile label="In review" value={summary.byStatus.reviewing} hint="Claimed by an admin" />
        <StatTile
          label="Solved"
          value={summary.byStatus.resolved}
          hint={`${summary.byStatus.dismissed} dismissed`}
          tone="good"
        />
        <StatTile
          label="Average rating"
          value={summary.averageRating === null ? "—" : summary.averageRating.toFixed(2)}
          hint={
            summary.ratedCount > 0
              ? `${summary.ratedCount} rated report${summary.ratedCount === 1 ? "" : "s"}, out of 5`
              : "Safety reports carry no rating"
          }
        />
      </StatTileGrid>

      {/* The trend is a feedback-tab question: safety reports have no rating. */}
      {isFeedbackTab && (
        <ChartFrame
          title="Average rating per day"
          description="Bangkok days. Only days that received a rating appear."
          footnote="A single low-rated day is noise; a week of them is a regression worth tracing to a pipeline change."
        >
          {summary.ratingTrend.length > 0 ? (
            <TimeSeriesChart
              data={summary.ratingTrend.map((point) => ({
                date: point.date,
                rating: Number(point.averageRating.toFixed(2)),
              }))}
              series={[{ key: "rating", label: "Average rating" }]}
              height={220}
            />
          ) : (
            <ChartEmpty
              height={220}
              message="No rated feedback in this range. Ratings are only collected on the final review step, so a quiet range usually means few completed videos."
            />
          )}
        </ChartFrame>
      )}

      {summary.byReason.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Most reported reasons
          </h2>
          <div className="flex flex-wrap gap-2">
            {summary.byReason.map((entry) => (
              <Link
                key={entry.reason}
                href={linkTo({ reason: entry.reason })}
                className={clsx(
                  "rounded-md border px-3 py-1.5 text-sm transition",
                  entry.reason === reason
                    ? "border-slate-300 bg-slate-100 font-medium text-slate-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                {REASON_LABELS[entry.reason] ?? entry.reason}
                <span className="ml-2 font-semibold text-slate-900">{entry.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          {activeTab.label}
        </h2>

        {reports.length === 0 ? (
          <EmptyQueue
            reportType={reportType}
            status={status}
            reason={reason}
            days={range.days}
            allStatusHref={linkTo({ status: "all" })}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {isFeedbackTab && <th className="px-4 py-3">Rating</th>}
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">What they said</th>
                  <th className="px-4 py-3">Reporter</th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Triage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.map((report) => (
                  <ReportRow key={report.id} report={report} showRating={isFeedbackTab} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reports.length === PAGE_SIZE && (
          <p className="mt-2 text-xs text-slate-400">
            Showing the {PAGE_SIZE} most recent reports in this range. Narrow the date range to see
            older ones.
          </p>
        )}
      </div>
    </div>
  );
}

function ReportRow({ report, showRating }: { report: FeedbackReport; showRating: boolean }) {
  const pill = STATUS_PILLS[report.status];

  return (
    <tr className="hover:bg-slate-50 align-top">
      {showRating && (
        <td className="px-4 py-3 whitespace-nowrap">
          <Stars rating={report.rating} />
        </td>
      )}
      <td className="px-4 py-3">
        <p className="font-medium text-slate-900">
          {REASON_LABELS[report.reason] ?? report.reason}
        </p>
        {/* The raw enum value stays visible: it is what the CHECK constraint,
            the SQL and any bug report will call this. */}
        <p className="text-xs text-slate-400">{report.reason}</p>
      </td>
      <td className="px-4 py-3">
        <Details text={report.details} />
        {report.resolutionNote && (
          <p className="mt-1 text-xs text-slate-500">
            <span className="font-medium text-slate-600">Note:</span> {report.resolutionNote}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        {report.reporterDeleted ? (
          // The account was anonymised in place (migration 014). The report is
          // still real, so the row stays; only the identity is gone.
          <span className="text-xs italic text-slate-400">Deleted account</span>
        ) : (
          <>
            <p className="text-slate-700">{report.reporterEmail ?? "—"}</p>
            {report.reporterName && (
              <p className="text-xs text-slate-400">{report.reporterName}</p>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/admin/requests/${report.requestId}`}
          className="text-blue-600 hover:underline"
        >
          {report.requestTitle ?? "Open request"}
        </Link>
        {!report.requestTitle && (
          // `request_id` has no foreign key (clip_requests.id is uuid in
          // production, text in the DDL), so it can outlive its request.
          <p className="text-xs text-slate-400">Request no longer exists</p>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-slate-500">
        <span title={report.createdAt.toISOString()}>{relativeAge(report.createdAt)}</span>
        <p className="text-xs text-slate-400">
          {report.createdAt.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      </td>
      <td className="px-4 py-3">
        <span
          className={clsx(
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
            pill.className
          )}
        >
          {pill.label}
        </span>
      </td>
      <td className="px-4 py-3">
        <FeedbackTriageButtons reportId={report.id} status={report.status} />
      </td>
    </tr>
  );
}

/**
 * Rating as filled stars AND the digit.
 *
 * Never colour or shape alone: the digit is the accessible value and the stars
 * are the shape that makes a column of them scannable.
 */
function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-slate-400">—</span>;
  const filled = Math.max(0, Math.min(5, rating));

  return (
    <span className="inline-flex items-baseline gap-1.5" aria-label={`${filled} out of 5`}>
      <span aria-hidden="true" className={filled <= 2 ? "text-red-500" : "text-amber-500"}>
        {"★".repeat(filled)}
        <span className="text-slate-300">{"★".repeat(5 - filled)}</span>
      </span>
      <span className="font-semibold text-slate-900">{filled}</span>
    </span>
  );
}

/**
 * Free text, truncated but never lost.
 *
 * `<details>` rather than a tooltip or a modal: the full text has to be
 * readable, selectable and printable, and this page has no modal machinery.
 */
const DETAILS_PREVIEW_LENGTH = 110;

function Details({ text }: { text: string | null }) {
  if (!text) return <span className="text-slate-400">—</span>;

  const collapsed = text.length > DETAILS_PREVIEW_LENGTH;
  if (!collapsed) return <p className="max-w-md text-slate-700">{text}</p>;

  return (
    <details className="max-w-md">
      <summary className="cursor-pointer text-slate-700 marker:text-slate-400">
        {text.slice(0, DETAILS_PREVIEW_LENGTH).trimEnd()}…
      </summary>
      <p className="mt-1 whitespace-pre-wrap text-slate-700">{text}</p>
    </details>
  );
}

/** "3 days ago". Coarse on purpose — triage cares about order of magnitude. */
function relativeAge(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86_400, "hour"],
    [2_592_000, "day"],
    [31_536_000, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];

  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  let previous = 1;
  for (const [limit, unit] of units) {
    if (seconds < limit) {
      return formatter.format(-Math.floor(seconds / previous), unit);
    }
    previous = limit;
  }
  return formatter.format(-Math.floor(seconds / 31_536_000), "year");
}

/**
 * Empty state that names the filter that emptied it.
 *
 * "No data" would be actively misleading here: the default view is
 * open-only over the last 30 days, so an empty table most often means the queue
 * is clear, not that the feature is broken.
 */
function EmptyQueue({
  reportType,
  status,
  reason,
  days,
  allStatusHref,
}: {
  reportType: FeedbackReportType;
  status: FeedbackReportStatus | "all";
  reason?: string;
  days: number;
  allStatusHref: string;
}) {
  const what = reportType === "feedback" ? "product feedback" : "safety reports";
  const statusWord =
    status === "all" ? "" : ` with status “${STATUS_PILLS[status as FeedbackReportStatus].label}”`;
  const reasonWord = reason ? ` for “${REASON_LABELS[reason] ?? reason}”` : "";

  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
      <p className="text-sm font-medium text-slate-700">
        No {what}
        {statusWord}
        {reasonWord} in the last {days} day{days === 1 ? "" : "s"}.
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {status === "open"
          ? "An empty open queue means everything reported in this range has been triaged."
          : "Widen the date range, or clear the filters, to see more."}
      </p>
      {status !== "all" && (
        <Link
          href={allStatusHref}
          className="mt-3 inline-block text-sm text-blue-600 hover:underline"
        >
          Show every status in this range
        </Link>
      )}
    </div>
  );
}

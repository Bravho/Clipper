import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import {
  adminDashboardService,
  type StaffCapacityStat,
  type CapacityStats,
} from "@/services/admin/AdminDashboardService";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";

export const metadata: Metadata = { title: "Workload — Admin" };

const ACTIVE_STAGE_ORDER = [
  RequestStatus.Submitted,
  RequestStatus.UnderReview,
  RequestStatus.AcceptedForProduction,
  RequestStatus.Editing,
  RequestStatus.ScheduledForPublishing,
  RequestStatus.Published,
];

export default async function AdminWorkloadPage() {
  await requireRole(Role.Admin);

  const [breakdown, capacity] = await Promise.all([
    adminDashboardService.getWorkloadBreakdown(),
    adminDashboardService.getCapacityStats(),
  ]);

  const now = new Date();

  const staffGroups = Object.entries(breakdown.byStaff).sort(([a], [b]) => {
    if (a === "unassigned") return 1;
    if (b === "unassigned") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Workload Overview</h1>
        <p className="mt-1 text-sm text-slate-500">
          {breakdown.activeTotal} active requests &middot; {capacity.activeStaffCount} active staff
        </p>
      </div>

      {/* Alert banners */}
      {breakdown.overdue.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-red-600 font-bold">!</span>
          <div>
            <p className="text-sm font-semibold text-red-800">
              {breakdown.overdue.length} request{breakdown.overdue.length !== 1 ? "s are" : " is"} overdue.
            </p>
            <p className="text-xs text-red-600">
              <Link href="/admin/sla" className="font-medium underline">View SLA monitor →</Link>
            </p>
          </div>
        </div>
      )}

      {breakdown.pendingAdminReviewCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
          <span className="text-orange-600 font-bold">!</span>
          <p className="text-sm text-orange-800">
            {breakdown.pendingAdminReviewCount} clip{breakdown.pendingAdminReviewCount !== 1 ? "s" : ""} pending your production review.{" "}
            <Link href="/admin/production-review" className="font-medium underline">Review now →</Link>
          </p>
        </div>
      )}

      {/* ── Section 1: Stage breakdown ──────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Active Queue by Stage
        </h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {ACTIVE_STAGE_ORDER.map((status) => {
            const count = breakdown.counts[status] ?? 0;
            const isPending = status === RequestStatus.ScheduledForPublishing;
            return (
              <div
                key={status}
                className={`rounded-lg border p-4 ${
                  isPending && count > 0 ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white"
                }`}
              >
                <p className={`text-2xl font-bold ${isPending && count > 0 ? "text-orange-700" : "text-slate-900"}`}>
                  {count}
                </p>
                <div className="mt-1">
                  <AdminStatusBadge status={status} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Section 2: Capacity projection ─────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Capacity Projection
        </h2>

        {/* Key numbers */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <p className="text-3xl font-bold text-slate-900">
              {capacity.totalDailyCapacity > 0
                ? capacity.totalDailyCapacity.toFixed(1)
                : "—"}
            </p>
            <p className="mt-1 text-sm text-slate-500">Requests / Day (current capacity)</p>
            <p className="mt-0.5 text-xs text-slate-400">{capacity.activeStaffCount} active staff</p>
          </div>

          <div
            className={`rounded-lg border p-5 ${
              capacity.unassignedRequestCount > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
            }`}
          >
            <p className={`text-3xl font-bold ${capacity.unassignedRequestCount > 0 ? "text-amber-700" : "text-slate-900"}`}>
              {capacity.unassignedRequestCount}
            </p>
            <p className={`mt-1 text-sm ${capacity.unassignedRequestCount > 0 ? "text-amber-600" : "text-slate-500"}`}>
              Unassigned Requests
            </p>
            <p className="mt-0.5 text-xs text-slate-400">not yet picked up by staff</p>
          </div>

          <div
            className={`rounded-lg border p-5 ${
              capacity.daysToCompleteAll !== null && capacity.daysToCompleteAll > capacity.targetDays
                ? "border-red-200 bg-red-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <p
              className={`text-3xl font-bold ${
                capacity.daysToCompleteAll !== null && capacity.daysToCompleteAll > capacity.targetDays
                  ? "text-red-700"
                  : "text-slate-900"
              }`}
            >
              {capacity.daysToCompleteAll !== null ? `${capacity.daysToCompleteAll}d` : "—"}
            </p>
            <p className="mt-1 text-sm text-slate-500">Days to Clear All Active Work</p>
            <p className="mt-0.5 text-xs text-slate-400">at current daily capacity</p>
          </div>

          <div
            className={`rounded-lg border p-5 ${
              capacity.additionalStaffNeeded > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"
            }`}
          >
            <p
              className={`text-3xl font-bold ${
                capacity.additionalStaffNeeded > 0 ? "text-red-700" : "text-green-700"
              }`}
            >
              {capacity.additionalStaffNeeded > 0 ? `+${capacity.additionalStaffNeeded}` : "✓ 0"}
            </p>
            <p
              className={`mt-1 text-sm ${
                capacity.additionalStaffNeeded > 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              Additional Staff / Clippers Needed
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              to complete all work within {capacity.targetDays} working days
            </p>
          </div>
        </div>

        {/* Projection bar chart */}
        <CapacityProjectionChart capacity={capacity} />
      </section>

      {/* ── Section 3: Per-staff stats (past output) ────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Staff Output History
        </h2>

        {capacity.staffStats.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center">
            <p className="text-sm text-slate-400">
              No completed request history available yet. Stats will appear once requests reach Published or Delivered status.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3 text-right">Completed</th>
                  <th className="px-4 py-3 text-right">Max / Day</th>
                  <th className="px-4 py-3 text-right">Avg / Day</th>
                  <th className="px-4 py-3 text-right">Days Active</th>
                  <th className="px-4 py-3 text-right">Capacity Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {capacity.staffStats
                  .sort((a, b) => b.completedRequests - a.completedRequests)
                  .map((stat) => (
                    <StaffStatRow key={stat.staffId} stat={stat} />
                  ))}
                {/* Totals row */}
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-4 py-3 text-slate-700">Total / Platform Average</td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    {capacity.staffStats.reduce((s, r) => s + r.completedRequests, 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    {Math.max(...capacity.staffStats.map((s) => s.maxPerDay), 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    {capacity.activeStaffCount > 0
                      ? (capacity.totalDailyCapacity / capacity.activeStaffCount).toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">—</td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {capacity.totalDailyCapacity.toFixed(2)}/day total
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section 4: Active requests by staff ─────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Current Active Assignments
        </h2>

        {staffGroups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center">
            <p className="text-sm text-slate-400">No active assignments.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {staffGroups.map(([staffId, requests]) => (
              <div key={staffId} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-700">
                      {staffId === "unassigned" ? (
                        <span className="text-amber-600">⚠ Unassigned</span>
                      ) : staffId}
                    </span>
                    {staffId !== "unassigned" && (() => {
                      const stat = capacity.staffStats.find((s) => s.staffId === staffId);
                      return stat ? (
                        <span className="text-xs text-slate-400">
                          avg {stat.avgPerDay}/day &middot; max {stat.maxPerDay}/day
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <span className="text-xs text-slate-500">
                    {requests.length} active request{requests.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {requests.map((req) => {
                    const isOverdue = req.confirmedDueDate && req.confirmedDueDate < now;
                    return (
                      <div key={req.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                        <div className="flex items-center gap-3">
                          <AdminStatusBadge status={req.status} />
                          <span className="text-sm text-slate-700">{req.title}</span>
                          {isOverdue && (
                            <span className="text-xs font-medium text-red-600">⚠ overdue</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          {req.confirmedDueDate && (
                            <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-slate-400"}`}>
                              due {req.confirmedDueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            </span>
                          )}
                          <Link
                            href={`/admin/requests/${req.id}`}
                            className="text-xs text-blue-600 hover:underline shrink-0"
                          >
                            Open →
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 5: Overdue list ──────────────────────────────────────────── */}
      {breakdown.overdue.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-red-400">
            Overdue Requests
          </h2>
          <div className="overflow-hidden rounded-lg border border-red-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Days Late</th>
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {breakdown.overdue.map((req) => {
                  const daysLate = req.confirmedDueDate
                    ? Math.ceil((now.getTime() - req.confirmedDueDate.getTime()) / (1000 * 60 * 60 * 24))
                    : 0;
                  return (
                    <tr key={req.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{req.title}</td>
                      <td className="px-4 py-3">
                        <AdminStatusBadge status={req.status} />
                      </td>
                      <td className="px-4 py-3 font-medium text-red-600">
                        {req.confirmedDueDate?.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </td>
                      <td className="px-4 py-3 font-bold text-red-700">{daysLate}d</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{req.assignedStaffId ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/requests/${req.id}`}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StaffStatRow({ stat }: { stat: StaffCapacityStat }) {
  // Bar width relative to max across all staff (capped visually at 100%)
  const barPct = Math.min(100, Math.round(stat.avgPerDay * 100));

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 font-medium text-slate-800">{stat.staffId}</td>
      <td className="px-4 py-3 text-right text-slate-900">{stat.completedRequests}</td>
      <td className="px-4 py-3 text-right font-semibold text-slate-900">{stat.maxPerDay}</td>
      <td className="px-4 py-3 text-right font-semibold text-blue-700">{stat.avgPerDay}</td>
      <td className="px-4 py-3 text-right text-slate-500">{stat.workingDaysActive}d</td>
      <td className="px-4 py-3">
        {/* Simple inline bar */}
        <div className="flex items-center gap-2 justify-end">
          <div className="w-24 bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${Math.max(barPct, 4)}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 w-12 text-right">
            {stat.avgPerDay}/day
          </span>
        </div>
      </td>
    </tr>
  );
}

function CapacityProjectionChart({ capacity }: { capacity: CapacityStats }) {
  if (capacity.totalActiveRequestCount === 0) return null;

  // For the visual bar: show proportion of (unassigned / total active)
  const unassignedPct =
    capacity.totalActiveRequestCount > 0
      ? Math.round((capacity.unassignedRequestCount / capacity.totalActiveRequestCount) * 100)
      : 0;
  const assignedPct = 100 - unassignedPct;

  // Days warning levels
  const daysAll = capacity.daysToCompleteAll;
  const daysColor =
    daysAll === null ? "text-slate-400"
    : daysAll > capacity.targetDays * 2 ? "text-red-700"
    : daysAll > capacity.targetDays ? "text-amber-700"
    : "text-green-700";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-5">
      <h3 className="text-sm font-semibold text-slate-700">Queue Clearance Projection</h3>

      {/* Work queue breakdown bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Active work queue ({capacity.totalActiveRequestCount} requests)</span>
          <span>{capacity.unassignedRequestCount} unassigned</span>
        </div>
        <div className="flex h-5 rounded-full overflow-hidden bg-slate-100">
          <div
            className="bg-blue-500 h-full flex items-center justify-center text-white text-xs font-medium"
            style={{ width: `${Math.max(assignedPct, 4)}%` }}
            title={`${capacity.assignedActiveRequestCount} assigned`}
          >
            {assignedPct > 15 ? `${capacity.assignedActiveRequestCount} assigned` : ""}
          </div>
          {capacity.unassignedRequestCount > 0 && (
            <div
              className="bg-amber-400 h-full flex items-center justify-center text-white text-xs font-medium"
              style={{ width: `${Math.max(unassignedPct, 4)}%` }}
              title={`${capacity.unassignedRequestCount} unassigned`}
            >
              {unassignedPct > 15 ? `${capacity.unassignedRequestCount} unassigned` : ""}
            </div>
          )}
        </div>
        <div className="flex gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" />
            Assigned to staff
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
            Unassigned
          </span>
        </div>
      </div>

      {/* Days-to-clear bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Estimated days to clear all active work</span>
          <span className={`font-bold text-sm ${daysColor}`}>
            {daysAll !== null ? `${daysAll} working days` : "No capacity data yet"}
          </span>
        </div>
        {daysAll !== null && (
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            {/* Target window */}
            <div
              className="bg-green-400 h-full"
              style={{ width: `${Math.min(100, Math.round((capacity.targetDays / Math.max(daysAll, capacity.targetDays)) * 100))}%` }}
              title={`Target: ${capacity.targetDays} days`}
            />
            {/* Excess beyond target */}
            {daysAll > capacity.targetDays && (
              <div
                className="bg-red-400 h-full"
                style={{
                  width: `${Math.min(100, Math.round(((daysAll - capacity.targetDays) / Math.max(daysAll, capacity.targetDays)) * 100))}%`,
                }}
                title={`${(daysAll - capacity.targetDays).toFixed(1)} days over target`}
              />
            )}
          </div>
        )}
        {daysAll !== null && (
          <div className="flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400" />
              Target window ({capacity.targetDays} days)
            </span>
            {daysAll > capacity.targetDays && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" />
                Over target (+{(daysAll - capacity.targetDays).toFixed(1)}d)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Staff needed breakdown */}
      <div className="grid gap-4 sm:grid-cols-3 pt-2 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-500">Current Staff</p>
          <p className="text-2xl font-bold text-slate-900">{capacity.activeStaffCount}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Additional Staff Needed</p>
          <p className={`text-2xl font-bold ${capacity.additionalStaffNeeded > 0 ? "text-red-700" : "text-green-600"}`}>
            {capacity.additionalStaffNeeded > 0 ? `+${capacity.additionalStaffNeeded}` : "None"}
          </p>
          <p className="text-xs text-slate-400">
            to clear all work in ≤{capacity.targetDays} days
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Combined Capacity Needed</p>
          <p className="text-2xl font-bold text-slate-900">
            {capacity.activeStaffCount + capacity.additionalStaffNeeded}
          </p>
          <p className="text-xs text-slate-400">total staff / clippers</p>
        </div>
      </div>

      <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
        Projection assumes current avg output rate per staff. Actual throughput varies by effort class and request complexity.
        Add more staff via the Users page once PostgreSQL staff provisioning is available.
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { staffDashboardService } from "@/services/staff/StaffDashboardService";
import { StaffStatusBadge } from "@/features/staff/components/StaffStatusBadge";

export const metadata: Metadata = { title: "Workload Summary — Staff" };

const STATUS_SECTIONS: Array<{
  status: RequestStatus;
  label: string;
  href: string;
}> = [
  { status: RequestStatus.Submitted,              label: "New Requests",          href: "/staff/editing" },
  { status: RequestStatus.Editing,                label: "In Editing",            href: "/staff/editing" },
  { status: RequestStatus.ScheduledForPublishing, label: "Production Review",     href: "/staff/production" },
  { status: RequestStatus.Published,              label: "Publishing",            href: "/staff/publishing" },
  { status: RequestStatus.OnHold,                 label: "On Hold",               href: "/staff/on-hold" },
];

export default async function WorkloadPage() {
  await requireRole(Role.Editor, Role.Admin);

  const { counts, overdue, byStatus } =
    await staffDashboardService.getWorkloadSummary();

  const totalActive =
    (counts[RequestStatus.Submitted] ?? 0) +
    (counts[RequestStatus.Editing] ?? 0) +
    (counts[RequestStatus.ScheduledForPublishing] ?? 0) +
    (counts[RequestStatus.Published] ?? 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Workload Summary</h1>
        <p className="mt-1 text-sm text-slate-500">
          Operational overview of all active requests in the system.
        </p>
      </div>

      {/* Top-level counts */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">{totalActive}</p>
          <p className="mt-1 text-sm text-slate-500">Active requests</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">
            {counts[RequestStatus.Submitted] ?? 0}
          </p>
          <p className="mt-1 text-sm text-slate-500">Awaiting acceptance</p>
        </div>
        <div className={`rounded-lg border p-4 ${overdue.length > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
          <p className={`text-3xl font-bold ${overdue.length > 0 ? "text-red-700" : "text-slate-900"}`}>
            {overdue.length}
          </p>
          <p className="mt-1 text-sm text-slate-500">Overdue</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">{counts[RequestStatus.OnHold] ?? 0}</p>
          <p className="mt-1 text-sm text-slate-500">On hold</p>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-slate-700">Requests by Status</h2>
        {STATUS_SECTIONS.map(({ status, label, href }) => {
          const sectionRequests = byStatus[status] ?? [];
          return (
            <div key={status} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <StaffStatusBadge status={status} />
                  <span className="text-sm font-medium text-slate-700">{label}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                    {sectionRequests.length}
                  </span>
                </div>
                <Link href={href} className="text-xs text-blue-600 hover:underline">
                  View queue →
                </Link>
              </div>
              {sectionRequests.length > 0 ? (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {sectionRequests.map((req) => {
                      const isOverdue =
                        !!req.confirmedDueDate && req.confirmedDueDate < new Date();
                      return (
                        <tr key={req.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <span className="font-medium text-slate-900">{req.title}</span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">
                            Submitted:{" "}
                            {req.submittedAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {req.dueDateConfirmed && req.confirmedDueDate ? (
                              <span className={isOverdue ? "font-medium text-red-600" : "text-slate-500"}>
                                Due: {req.confirmedDueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                {isOverdue && " (overdue)"}
                              </span>
                            ) : (
                              <span className="text-slate-400">No due date</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Link
                              href={`/staff/requests/${req.id}`}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Open →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-3 text-sm text-slate-400">None.</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Overdue detail */}
      {overdue.length > 0 && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-red-700">Overdue Requests</h2>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
            {overdue.map((req) => (
              <div key={req.id} className="flex items-center justify-between rounded-md bg-white px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{req.title}</p>
                  <div className="flex gap-3 text-xs text-slate-500">
                    <StaffStatusBadge status={req.status} />
                    <span className="text-red-600">
                      Due: {req.confirmedDueDate?.toLocaleDateString("en-GB") ?? "—"}
                    </span>
                  </div>
                </div>
                <Link href={`/staff/requests/${req.id}`} className="text-xs text-blue-600 hover:underline">
                  Open →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

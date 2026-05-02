import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { adminDashboardService } from "@/services/admin/AdminDashboardService";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";

export const metadata: Metadata = { title: "SLA Monitor — Admin" };

export default async function AdminSlaPage() {
  await requireRole(Role.Admin);

  const slaData = await adminDashboardService.getSlaData();
  const now = new Date();

  const sections = [
    {
      title: "Overdue — Past Confirmed Due Date",
      items: slaData.overdue,
      empty: "No overdue requests.",
      urgency: "high" as const,
    },
    {
      title: "Due Soon — Within 1 Working Day",
      items: slaData.dueSoon,
      empty: "No requests due within 1 working day.",
      urgency: "medium" as const,
    },
    {
      title: "Stale in Production Review (>24h)",
      items: slaData.pendingReviewStale,
      empty: "No stale production reviews.",
      urgency: "medium" as const,
    },
    {
      title: "Published — Not Yet Delivered",
      items: slaData.publishedNotDelivered,
      empty: "No published requests awaiting delivery.",
      urgency: "low" as const,
    },
  ];

  const urgencyClasses = {
    high: {
      banner: "border-red-200 bg-red-50",
      bannerText: "text-red-800",
      count: "text-red-700",
      countBg: "bg-red-100",
      header: "text-red-400",
    },
    medium: {
      banner: "border-amber-200 bg-amber-50",
      bannerText: "text-amber-800",
      count: "text-amber-700",
      countBg: "bg-amber-100",
      header: "text-amber-400",
    },
    low: {
      banner: "border-slate-200 bg-slate-50",
      bannerText: "text-slate-700",
      count: "text-slate-700",
      countBg: "bg-slate-100",
      header: "text-slate-400",
    },
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">SLA Monitor</h1>
        <p className="mt-1 text-sm text-slate-500">
          Track service level risks: overdue, due soon, and stalled requests.
        </p>
      </div>

      {/* SLA rule reminder */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <span className="font-medium">SLA Target:</span> Normally within 2 working days after
        staff acceptance of complete and usable materials. This is a target, not a guarantee.
        Timing is based on queue position and staff capacity.
      </div>

      {/* Summary counts */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sections.map((s) => {
          const c = urgencyClasses[s.urgency];
          return (
            <div
              key={s.title}
              className={`rounded-lg border p-4 ${s.items.length > 0 ? c.banner : "border-slate-200 bg-white"}`}
            >
              <p className={`text-3xl font-bold ${s.items.length > 0 ? c.count : "text-slate-900"}`}>
                {s.items.length}
              </p>
              <p className="mt-1 text-xs text-slate-500">{s.title}</p>
            </div>
          );
        })}
      </div>

      {/* Per-section tables */}
      {sections.map((section) => {
        const c = urgencyClasses[section.urgency];
        return (
          <div key={section.title}>
            <h2 className={`mb-3 text-sm font-semibold uppercase tracking-wider ${c.header}`}>
              {section.title}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${c.countBg} ${c.count}`}
              >
                {section.items.length}
              </span>
            </h2>

            {section.items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center">
                <p className="text-sm text-slate-400">{section.empty}</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">Request</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Due Date</th>
                      <th className="px-4 py-3">Days Late / Left</th>
                      <th className="px-4 py-3">Staff</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {section.items.map((req) => {
                      const dueMs = req.confirmedDueDate
                        ? req.confirmedDueDate.getTime() - now.getTime()
                        : null;
                      const daysDiff = dueMs
                        ? Math.ceil(Math.abs(dueMs) / (1000 * 60 * 60 * 24))
                        : null;
                      const isPast = dueMs !== null && dueMs < 0;

                      return (
                        <tr key={req.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900 max-w-xs truncate">
                            {req.title}
                          </td>
                          <td className="px-4 py-3">
                            <AdminStatusBadge status={req.status} />
                          </td>
                          <td className="px-4 py-3">
                            {req.confirmedDueDate ? (
                              <span className={isPast ? "font-medium text-red-600" : "text-slate-600"}>
                                {req.confirmedDueDate.toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                })}
                              </span>
                            ) : (
                              <span className="text-slate-400">Unconfirmed</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {daysDiff !== null ? (
                              <span
                                className={
                                  isPast
                                    ? "font-bold text-red-700"
                                    : "font-medium text-amber-600"
                                }
                              >
                                {isPast ? `${daysDiff}d overdue` : `${daysDiff}d left`}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">
                            {req.assignedStaffId ?? "—"}
                          </td>
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
            )}
          </div>
        );
      })}
    </div>
  );
}

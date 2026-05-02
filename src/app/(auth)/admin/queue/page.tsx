import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { adminDashboardService } from "@/services/admin/AdminDashboardService";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";

export const metadata: Metadata = { title: "Queue Monitor — Admin" };

export default async function AdminQueuePage() {
  await requireRole(Role.Admin);

  const snapshot = await adminDashboardService.getQueueSnapshot();

  const sections = [
    {
      title: "Submitted — Awaiting Review",
      items: snapshot.submittedRequests,
      emptyText: "No submitted requests waiting.",
      urgency: false,
    },
    {
      title: "Under Review & Accepted",
      items: snapshot.underReviewRequests,
      emptyText: "No requests under review.",
      urgency: false,
    },
    {
      title: "In Editing",
      items: snapshot.editingRequests,
      emptyText: "No requests in editing.",
      urgency: false,
    },
    {
      title: "Pending Admin Production Review",
      items: snapshot.productionReviewRequests,
      emptyText: "No clips awaiting admin review.",
      urgency: true,
      actionHref: "/admin/production-review",
    },
    {
      title: "Published — Awaiting Delivery",
      items: snapshot.publishedRequests,
      emptyText: "No published requests awaiting delivery.",
      urgency: false,
    },
    {
      title: "On Hold",
      items: snapshot.onHoldRequests,
      emptyText: "No requests on hold.",
      urgency: true,
    },
    {
      title: "Overdue",
      items: snapshot.overdueRequests,
      emptyText: "No overdue requests.",
      urgency: true,
    },
  ];

  const now = new Date();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Global Queue Monitor</h1>
        <p className="mt-1 text-sm text-slate-500">
          Full system view across all production stages.
        </p>
      </div>

      {/* Stage counts */}
      <div className="grid gap-3 sm:grid-cols-4">
        {sections.map((s) => (
          <div
            key={s.title}
            className={`rounded-lg border p-4 ${
              s.urgency && s.items.length > 0
                ? "border-red-200 bg-red-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <p
              className={`text-2xl font-bold ${
                s.urgency && s.items.length > 0 ? "text-red-700" : "text-slate-900"
              }`}
            >
              {s.items.length}
            </p>
            <p
              className={`mt-1 text-xs ${
                s.urgency && s.items.length > 0 ? "text-red-600" : "text-slate-500"
              }`}
            >
              {s.title}
            </p>
          </div>
        ))}
      </div>

      {/* Per-stage tables */}
      {sections.map((section) => (
        <div key={section.title}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              {section.title}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${
                  section.urgency && section.items.length > 0
                    ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {section.items.length}
              </span>
            </h2>
            {section.actionHref && section.items.length > 0 && (
              <Link
                href={section.actionHref}
                className="text-xs text-orange-600 hover:underline font-medium"
              >
                Review queue →
              </Link>
            )}
          </div>

          {section.items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center">
              <p className="text-sm text-slate-400">{section.emptyText}</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3">Staff</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {section.items.map((req) => {
                    const isOverdue =
                      req.confirmedDueDate &&
                      req.confirmedDueDate < now &&
                      !["published", "delivered", "rejected"].includes(req.status);

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
                            <span
                              className={
                                isOverdue ? "font-medium text-red-600" : "text-slate-600"
                              }
                            >
                              {req.confirmedDueDate.toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })}
                              {isOverdue && " ⚠"}
                            </span>
                          ) : (
                            <span className="text-slate-400">Unconfirmed</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {req.assignedStaffId ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {req.updatedAt.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
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
      ))}
    </div>
  );
}

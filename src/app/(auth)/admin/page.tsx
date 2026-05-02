import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { adminDashboardService } from "@/services/admin/AdminDashboardService";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";

export const metadata: Metadata = { title: "Admin Dashboard — RClipper" };

function StatCard({
  label,
  value,
  href,
  urgent,
}: {
  label: string;
  value: number;
  href: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg border p-5 transition hover:shadow-sm ${
        urgent && value > 0
          ? "border-red-200 bg-red-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className={`text-3xl font-bold ${urgent && value > 0 ? "text-red-700" : "text-slate-900"}`}>
        {value}
      </p>
      <p className={`mt-1 text-sm ${urgent && value > 0 ? "text-red-600" : "text-slate-500"}`}>
        {label}
      </p>
    </Link>
  );
}

export default async function AdminDashboardPage() {
  const user = await requireRole(Role.Admin);
  const summary = await adminDashboardService.getSummary();

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {today} &middot; Signed in as{" "}
            <span className="font-medium">{user.name}</span>
            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              Admin
            </span>
          </p>
        </div>
        <Link
          href="/staff"
          className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
        >
          → Staff view
        </Link>
      </div>

      {/* Operational alerts */}
      <div className="space-y-2">
        {summary.pendingAdminReviewCount > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
            <span className="text-orange-600 font-bold">!</span>
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {summary.pendingAdminReviewCount} clip{summary.pendingAdminReviewCount !== 1 ? "s" : ""} pending your production review.
              </p>
              <p className="text-xs text-orange-600">
                Staff has submitted these for admin approval before publishing.{" "}
                <Link href="/admin/production-review" className="font-medium underline">
                  Review now →
                </Link>
              </p>
            </div>
          </div>
        )}

        {summary.overdueCount > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <span className="text-red-600 font-bold">!</span>
            <div>
              <p className="text-sm font-semibold text-red-800">
                {summary.overdueCount} request{summary.overdueCount !== 1 ? "s are" : " is"} past the confirmed due date.
              </p>
              <p className="text-xs text-red-600">
                <Link href="/admin/sla" className="font-medium underline">
                  View SLA monitor →
                </Link>
              </p>
            </div>
          </div>
        )}

        {summary.onHoldCount > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-amber-600 font-bold">!</span>
            <p className="text-sm text-amber-800">
              {summary.onHoldCount} request{summary.onHoldCount !== 1 ? "s are" : " is"} on hold.{" "}
              <Link href="/admin/queue" className="font-medium underline">
                View queue →
              </Link>
            </p>
          </div>
        )}
      </div>

      {/* Pipeline overview */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Pipeline Overview
        </h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Submitted" value={summary.submittedCount} href="/admin/queue" />
          <StatCard label="Under Review" value={summary.underReviewCount} href="/admin/queue" />
          <StatCard label="Accepted" value={summary.acceptedCount} href="/admin/queue" />
          <StatCard label="In Editing" value={summary.editingCount} href="/admin/workload" />
          <StatCard
            label="Pending Admin Review"
            value={summary.pendingAdminReviewCount}
            href="/admin/production-review"
            urgent
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <StatCard label="Published" value={summary.publishedCount} href="/admin/delivery" />
          <StatCard label="Delivered (total)" value={summary.deliveredCount} href="/admin/delivery" />
          <StatCard label="On Hold" value={summary.onHoldCount} href="/admin/queue" urgent />
          <StatCard label="Overdue" value={summary.overdueCount} href="/admin/sla" urgent />
        </div>
      </div>

      {/* Recent activity */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Recent Activity
          </h2>
          <Link href="/admin/requests" className="text-xs text-blue-600 hover:underline">
            All requests →
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Request</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.recentActivity.map((req) => {
                const isOverdue =
                  req.confirmedDueDate &&
                  req.confirmedDueDate < new Date() &&
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
                        <span className={isOverdue ? "text-red-600 font-medium" : "text-slate-600"}>
                          {req.confirmedDueDate.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                          {isOverdue && " ⚠"}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
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
      </div>

      {/* Quick links */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Quick Links
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Production Review", href: "/admin/production-review" },
            { label: "Queue Monitor", href: "/admin/queue" },
            { label: "All Requests", href: "/admin/requests" },
            { label: "Delivery", href: "/admin/delivery" },
            { label: "Users", href: "/admin/users" },
            { label: "Credits", href: "/admin/credits" },
            { label: "Workload", href: "/admin/workload" },
            { label: "SLA Monitor", href: "/admin/sla" },
            { label: "External Workforce", href: "/admin/external-workforce-placeholder" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

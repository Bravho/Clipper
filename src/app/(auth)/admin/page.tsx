import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { ADMIN_NAV_LINKS } from "@/config/adminNav";
import { adminDashboardService } from "@/services/admin/AdminDashboardService";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";

export const metadata: Metadata = { title: "Admin Dashboard — RClipper" };

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

      {/* Operational alerts */}
      <div className="space-y-2">
        {summary.overdueCount > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <span className="text-red-600 font-bold">!</span>
            <p className="text-sm font-semibold text-red-800">
              {summary.overdueCount} request{summary.overdueCount !== 1 ? "s are" : " is"} past the confirmed due date.{" "}
              <Link href={ROUTES.ADMIN_REQUESTS} className="font-medium underline">
                View requests →
              </Link>
            </p>
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
        <StatTileGrid>
          <StatTile label="Submitted" value={summary.submittedCount} href={ROUTES.ADMIN_QUEUE} />
          <StatTile label="Under Review" value={summary.underReviewCount} href={ROUTES.ADMIN_QUEUE} />
          <StatTile label="Accepted" value={summary.acceptedCount} href={ROUTES.ADMIN_QUEUE} />
          <StatTile label="In Editing" value={summary.editingCount} href={ROUTES.ADMIN_QUEUE} />
        </StatTileGrid>
        <div className="mt-4">
          <StatTileGrid>
            <StatTile label="Published" value={summary.publishedCount} href={ROUTES.ADMIN_REQUESTS} />
            <StatTile
              label="Delivered (total)"
              value={summary.deliveredCount}
              hint={`${summary.deliveredRecentCount} in the last 14 days`}
              href={ROUTES.ADMIN_REQUESTS}
            />
            <StatTile label="On Hold" value={summary.onHoldCount} href={ROUTES.ADMIN_QUEUE} tone="urgent" />
            <StatTile label="Overdue" value={summary.overdueCount} href={ROUTES.ADMIN_REQUESTS} tone="urgent" />
          </StatTileGrid>
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
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[44rem] text-sm">
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

      {/* Quick links — rendered from the nav config rather than a local array.
          The hand-maintained copy this replaces had already drifted: it still
          advertised five deleted pages and none of the analytics ones. */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Quick Links
        </h2>
        <div className="flex flex-wrap gap-2">
          {ADMIN_NAV_LINKS.filter((link) => link.href !== ROUTES.ADMIN).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <span className="mr-2 opacity-60">{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

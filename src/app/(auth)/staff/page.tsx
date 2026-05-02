import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { staffDashboardService } from "@/services/staff/StaffDashboardService";
import { StaffStatusBadge } from "@/features/staff/components/StaffStatusBadge";

export const metadata: Metadata = { title: "Staff Dashboard — RClipper" };

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
          ? "border-amber-200 bg-amber-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-3xl font-bold text-slate-900">{value}</p>
      <p className={`mt-1 text-sm ${urgent && value > 0 ? "text-amber-700" : "text-slate-500"}`}>
        {label}
      </p>
    </Link>
  );
}

export default async function StaffDashboardPage() {
  const user = await requireRole(Role.Editor, Role.Admin);
  const summary = await staffDashboardService.getSummary();

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
        <h1 className="text-2xl font-bold text-slate-900">Staff Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          {today} &middot; Signed in as{" "}
          <span className="font-medium">{user.name}</span>
        </p>
      </div>

      {/* At-risk alert */}
      {summary.overdueCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-red-600 font-bold">!</span>
          <div>
            <p className="text-sm font-semibold text-red-800">
              {summary.overdueCount} request{summary.overdueCount !== 1 ? "s are" : " is"} past the confirmed due date.
            </p>
            <p className="text-xs text-red-600">
              Check the production and editing queues.
            </p>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Today&apos;s Queue
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="New Requests" value={summary.newRequestsCount} href="/staff/editing" />
          <StatCard label="In Editing" value={summary.editingCount} href="/staff/editing" />
          <StatCard label="Production Review" value={summary.productionReviewCount} href="/staff/production" />
          <StatCard label="Publishing" value={summary.publishingCount} href="/staff/publishing" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="On Hold" value={summary.onHoldCount} href="/staff/on-hold" urgent />
        <StatCard label="Delivered (last 14 days)" value={summary.deliveredRecentCount} href="/staff/workload" />
        <StatCard label="Overdue" value={summary.overdueCount} href="/staff/workload" urgent />
      </div>

      {/* Recent activity */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Recent Activity
          </h2>
          <Link href="/staff/workload" className="text-xs text-blue-600 hover:underline">
            Full workload →
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Request</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.recentActivity.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{req.title}</td>
                  <td className="px-4 py-3">
                    <StaffStatusBadge status={req.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {req.updatedAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/staff/requests/${req.id}`}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
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
            { label: "Editing", href: "/staff/editing" },
            { label: "Production Review", href: "/staff/production" },
            { label: "Publishing", href: "/staff/publishing" },
            { label: "On Hold", href: "/staff/on-hold" },
            { label: "Rejected", href: "/staff/rejected" },
            { label: "Workload Summary", href: "/staff/workload" },
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

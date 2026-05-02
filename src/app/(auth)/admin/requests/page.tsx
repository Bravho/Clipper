import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, productionReviewRepository } from "@/repositories";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";

export const metadata: Metadata = { title: "All Requests — Admin" };

export default async function AdminRequestsPage() {
  await requireRole(Role.Admin);

  const [requests, pendingReviews] = await Promise.all([
    clipRequestRepository.findAll(),
    productionReviewRepository.findByStatus(ProductionReviewStatus.Pending),
  ]);

  const pendingReviewIds = new Set(pendingReviews.map((r) => r.requestId));
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">All Requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          {requests.length} total requests across the system.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Admin Review</th>
              <th className="px-4 py-3">Due Date</th>
              <th className="px-4 py-3">Effort</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((req) => {
              const isPendingReview = pendingReviewIds.has(req.id);
              const isOverdue =
                req.confirmedDueDate &&
                req.confirmedDueDate < now &&
                !["published", "delivered", "rejected", "draft"].includes(req.status);

              return (
                <tr key={req.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 max-w-xs truncate">{req.title}</p>
                    {req.holdReason && (
                      <p className="text-xs text-amber-600">On hold</p>
                    )}
                    {req.rejectionReason && (
                      <p className="text-xs text-red-500">Rejected</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <AdminStatusBadge status={req.status} />
                  </td>
                  <td className="px-4 py-3">
                    {isPendingReview ? (
                      <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                        Needs Review
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {req.confirmedDueDate ? (
                      <span className={isOverdue ? "font-medium text-red-600" : "text-slate-600"}>
                        {req.confirmedDueDate.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "2-digit",
                        })}
                        {isOverdue && " ⚠"}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 capitalize">
                    {req.effortClass ?? "—"}
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
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";
import {
  clipRequestRepository,
  productionReviewRepository,
} from "@/repositories";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";
import { ProductionReviewBadge } from "@/features/admin/components/ProductionReviewBadge";

export const metadata: Metadata = { title: "Production Review — Admin" };

export default async function ProductionReviewPage() {
  await requireRole(Role.Admin);

  const [scheduledRequests, pendingReviews] = await Promise.all([
    clipRequestRepository.findByStatus([RequestStatus.ScheduledForPublishing]),
    productionReviewRepository.findByStatus(ProductionReviewStatus.Pending),
  ]);

  const pendingRequestIds = new Set(pendingReviews.map((r) => r.requestId));

  // Separate active pending from already-actioned ScheduledForPublishing requests
  const pendingItems = scheduledRequests.filter((r) => pendingRequestIds.has(r.id));
  const reviewedItems = scheduledRequests.filter((r) => !pendingRequestIds.has(r.id));

  const now = new Date();

  function ageInHours(date: Date) {
    return Math.round((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Production Review</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review clips submitted by staff for admin approval before publishing.
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-3xl font-bold text-orange-700">{pendingItems.length}</p>
          <p className="mt-1 text-sm text-orange-600">Pending Your Review</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">{reviewedItems.length}</p>
          <p className="mt-1 text-sm text-slate-500">Awaiting Publishing Action</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">{scheduledRequests.length}</p>
          <p className="mt-1 text-sm text-slate-500">Total in Stage</p>
        </div>
      </div>

      {/* Pending review queue */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Pending Admin Review
        </h2>

        {pendingItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">No clips awaiting your review.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Review Status</th>
                  <th className="px-4 py-3">Age in Review</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingItems.map((req) => {
                  const review = pendingReviews.find((r) => r.requestId === req.id);
                  const age = review ? ageInHours(review.submittedAt) : 0;
                  const isOverdue =
                    req.confirmedDueDate && req.confirmedDueDate < now;

                  return (
                    <tr key={req.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{req.title}</p>
                        <p className="text-xs text-slate-400">
                          {req.targetPlatforms.join(", ")}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <ProductionReviewBadge status={ProductionReviewStatus.Pending} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            age > 24 ? "font-medium text-red-600" : "text-slate-600"
                          }
                        >
                          {age}h
                          {age > 24 && " ⚠"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {req.confirmedDueDate ? (
                          <span
                            className={isOverdue ? "font-medium text-red-600" : "text-slate-600"}
                          >
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
                        {req.assignedStaffId ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/requests/${req.id}`}
                          className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 transition"
                        >
                          Review →
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

      {/* Already reviewed but still in ScheduledForPublishing */}
      {reviewedItems.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Awaiting Publishing Action
          </h2>
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
                {reviewedItems.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{req.title}</td>
                    <td className="px-4 py-3">
                      <AdminStatusBadge status={req.status} />
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

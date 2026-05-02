import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository } from "@/repositories";
import { EFFORT_CLASS_LABELS } from "@/domain/enums/EffortClass";
import { dueDateConfirmationService } from "@/services/staff/DueDateConfirmationService";
import { StaffStatusBadge } from "@/features/staff/components/StaffStatusBadge";

export const metadata: Metadata = { title: "Due Date Confirmation — Staff" };

export default async function DueDateConfirmationPage() {
  await requireRole(Role.Editor, Role.Admin);

  const pending = await clipRequestRepository.findPendingDueDateConfirmation();
  const overdue = await clipRequestRepository.findOverdue();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Due Date Confirmation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Requests that need a due date confirmed before the requester can see an expected
          completion date. Requesters see a &ldquo;pending review&rdquo; message until you confirm.
        </p>
      </div>

      {/* Pending confirmation */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-800">Pending Confirmation</h2>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            {pending.length}
          </span>
        </div>

        {pending.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">All active requests have confirmed due dates.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Effort</th>
                  <th className="px-4 py-3">System Estimate</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map((request) => {
                  const dueDateStatus = dueDateConfirmationService.getDueDateStatus(request);
                  return (
                    <tr key={request.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{request.title}</p>
                        <p className="text-xs text-slate-400">#{request.id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StaffStatusBadge status={request.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {request.effortClass
                          ? EFFORT_CLASS_LABELS[request.effortClass]
                          : <span className="text-slate-400">Not set</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {dueDateStatus.formattedEstimate ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {request.submittedAt?.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        }) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/staff/requests/${request.id}`}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Confirm →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Overdue */}
      {overdue.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-red-700">Overdue</h2>
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
              {overdue.length}
            </span>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="mb-3 text-sm text-red-700">
              These requests have passed their confirmed due date. Review and update the requester.
            </p>
            <div className="space-y-2">
              {overdue.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between rounded-md bg-white px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-slate-900">{req.title}</p>
                    <p className="text-xs text-red-600">
                      Due: {req.confirmedDueDate?.toLocaleDateString("en-GB") ?? "—"}
                    </p>
                  </div>
                  <Link
                    href={`/staff/requests/${req.id}`}
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    Open →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

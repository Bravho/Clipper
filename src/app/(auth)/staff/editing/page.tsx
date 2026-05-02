import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestRepository, internalNoteRepository } from "@/repositories";
import { StaffStatusBadge } from "@/features/staff/components/StaffStatusBadge";

export const metadata: Metadata = { title: "Editing — Staff" };

function daysLabel(date: Date | null | undefined): { text: string; urgent: boolean } {
  if (!date) return { text: "No due date", urgent: false };
  const now = new Date();
  const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, urgent: true };
  if (diff === 0) return { text: "Due today", urgent: true };
  if (diff === 1) return { text: "Due tomorrow", urgent: true };
  return { text: `${diff}d remaining`, urgent: false };
}

export default async function EditingPage() {
  const currentUser = await requireRole(Role.Editor, Role.Admin);

  const [newRequests, rejectedRequests, editingRequests] = await Promise.all([
    clipRequestRepository.findByStatus([RequestStatus.Submitted]),
    clipRequestRepository.findByStatus([RequestStatus.Rejected]),
    clipRequestRepository.findByStatus([RequestStatus.Editing]),
  ]);

  const newRows = await Promise.all(
    [...newRequests, ...rejectedRequests].map(async (req) => ({
      req,
      latestNote: await internalNoteRepository.findLatestByRequestId(req.id),
    }))
  );

  const editingRows = await Promise.all(
    editingRequests.map(async (req) => ({
      req,
      latestNote: await internalNoteRepository.findLatestByRequestId(req.id),
    }))
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Editing</h1>
        <p className="mt-1 text-sm text-slate-500">
          New requests awaiting acceptance, and requests currently in active editing.
        </p>
      </div>

      {/* New requests — need accepting */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-800">New Requests</h2>
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {newRows.length}
          </span>
        </div>

        {newRows.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
            <p className="text-sm text-slate-400">No new requests.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {newRows.map(({ req, latestNote }) => {
              const isRejected = req.status === RequestStatus.Rejected;
              return (
                <div
                  key={req.id}
                  className={`rounded-lg border bg-white p-5 ${
                    isRejected ? "border-red-100" : "border-blue-100"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900">{req.title}</h3>
                        <StaffStatusBadge status={req.status} />
                      </div>
                      <p className="text-xs text-slate-500">
                        Submitted:{" "}
                        {req.submittedAt?.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }) ?? "—"}
                      </p>
                      <p className="text-xs text-slate-400 line-clamp-2">{req.description}</p>
                      {isRejected && req.rejectionReason && (
                        <p className="text-xs text-red-500 line-clamp-1">
                          <strong>Rejected:</strong> {req.rejectionReason}
                        </p>
                      )}
                      {latestNote && (
                        <p className="text-xs text-slate-400 line-clamp-1">
                          <strong>Note:</strong> {latestNote.content}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/staff/requests/${req.id}`}
                      className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium text-white ${
                        isRejected
                          ? "bg-red-600 hover:bg-red-700"
                          : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      {isRejected ? "Re-accept →" : "Review & Accept →"}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Active editing */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-800">In Editing</h2>
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
            {editingRows.length}
          </span>
        </div>


        {editingRows.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
            <p className="text-sm text-slate-400">Nothing currently in editing.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {editingRows.map(({ req, latestNote }) => {
              const days = daysLabel(req.confirmedDueDate);
              const isOverdue = !!req.confirmedDueDate && req.confirmedDueDate < new Date();
              const isLockedByOther =
                !!req.assignedStaffId && req.assignedStaffId !== currentUser.id;
              return (
                <div
                  key={req.id}
                  className={`rounded-lg border bg-white p-5 ${isOverdue ? "border-red-200" : "border-slate-200"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900">{req.title}</h3>
                        <StaffStatusBadge status={req.status} />
                        {isLockedByOther && (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                            Taken
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          days.urgent ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                        }`}>
                          {days.text}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                        <span>
                          Due:{" "}
                          <strong className={isOverdue ? "text-red-600" : ""}>
                            {req.confirmedDueDate?.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) ?? "—"}
                          </strong>
                        </span>
                        {req.effortClass && (
                          <span>Effort: <strong>{req.effortClass}</strong></span>
                        )}
                      </div>
                      {latestNote && (
                        <p className="text-xs text-slate-400 line-clamp-1">
                          <strong>Note:</strong> {latestNote.content}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/staff/requests/${req.id}`}
                      className="shrink-0 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

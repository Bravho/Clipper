import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestRepository, internalNoteRepository } from "@/repositories";
import { StaffStatusBadge } from "@/features/staff/components/StaffStatusBadge";

export const metadata: Metadata = { title: "Production Review — Staff" };

export default async function ProductionReviewPage() {
  await requireRole(Role.Editor, Role.Admin);

  // Production = requests submitted for admin review (ScheduledForPublishing)
  const requests = await clipRequestRepository.findByStatus([
    RequestStatus.ScheduledForPublishing,
  ]);

  const rows = await Promise.all(
    requests.map(async (req) => {
      const latestNote = await internalNoteRepository.findLatestByRequestId(req.id);
      return { req, latestNote };
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Production Review</h1>
        <p className="mt-1 text-sm text-slate-500">
          Clips that have been edited and submitted for review before publishing.
          Approve to move to publishing, or return to editing for revisions.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">No clips awaiting production review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ req, latestNote }) => {
            const isOverdue = !!req.confirmedDueDate && req.confirmedDueDate < new Date();
            return (
              <div
                key={req.id}
                className={`rounded-lg border bg-white p-5 ${
                  isOverdue ? "border-red-200" : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{req.title}</h3>
                      <StaffStatusBadge status={req.status} />
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                      <span>
                        Due:{" "}
                        <strong className={isOverdue ? "text-red-600" : ""}>
                          {req.confirmedDueDate
                            ? req.confirmedDueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                            : "—"}
                        </strong>
                      </span>
                      {req.effortClass && (
                        <span>Effort: <strong>{req.effortClass}</strong></span>
                      )}
                      {req.exportReady && (
                        <span className="font-medium text-green-600">Export ready</span>
                      )}
                    </div>
                    {req.editingProgressNote && (
                      <p className="text-xs text-slate-500">
                        <strong>Editor note:</strong> {req.editingProgressNote}
                      </p>
                    )}
                    {latestNote && (
                      <p className="text-xs text-slate-400 line-clamp-1">
                        <strong>Latest note:</strong> {latestNote.content}
                      </p>
                    )}
                  </div>
                  <Link
                    href={`/staff/requests/${req.id}`}
                    className="shrink-0 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Review →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

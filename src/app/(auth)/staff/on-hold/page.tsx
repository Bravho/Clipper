import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestRepository, internalNoteRepository } from "@/repositories";
import { StaffRequestTable } from "@/features/staff/components/StaffRequestTable";

export const metadata: Metadata = { title: "On Hold — Staff" };

export default async function OnHoldPage() {
  await requireRole(Role.Editor, Role.Admin);

  const requests = await clipRequestRepository.findByStatus([RequestStatus.OnHold]);

  const rows = await Promise.all(
    requests.map(async (request) => {
      const latestNote = await internalNoteRepository.findLatestByRequestId(request.id);
      return { request, latestNote };
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">On Hold</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} request{rows.length !== 1 ? "s" : ""} currently on hold.
          Resume when the issue is resolved.
        </p>
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Hold reasons below are visible to requesters. Resume a request to return it to Under Review.
        </div>
      )}

      <StaffRequestTable
        rows={rows}
        columns={["title", "submitted", "holdReason", "latestNote"]}
        emptyMessage="No requests currently on hold."
      />
    </div>
  );
}

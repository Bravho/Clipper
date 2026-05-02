import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestRepository, internalNoteRepository } from "@/repositories";
import { StaffRequestTable } from "@/features/staff/components/StaffRequestTable";

export const metadata: Metadata = { title: "Rejected — Staff" };

export default async function RejectedPage() {
  await requireRole(Role.Editor, Role.Admin);

  const requests = await clipRequestRepository.findByStatus([RequestStatus.Rejected]);

  const rows = await Promise.all(
    requests.map(async (request) => {
      const latestNote = await internalNoteRepository.findLatestByRequestId(request.id);
      return { request, latestNote };
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Rejected Requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} rejected request{rows.length !== 1 ? "s" : ""}.
          Rejection reasons are shown to requesters. Any staff can re-accept a rejected request
          — these also appear at the top of the{" "}
          <a href="/staff/editing" className="text-blue-600 hover:underline">Editing queue</a>.
        </p>
      </div>

      <StaffRequestTable
        rows={rows}
        columns={["title", "submitted", "rejectionReason", "latestNote"]}
        emptyMessage="No rejected requests."
      />
    </div>
  );
}

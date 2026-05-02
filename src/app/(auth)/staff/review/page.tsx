import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestRepository, uploadedAssetRepository, internalNoteRepository } from "@/repositories";
import { StaffRequestTable } from "@/features/staff/components/StaffRequestTable";

export const metadata: Metadata = { title: "Review Queue — Staff" };

export default async function ReviewQueuePage() {
  await requireRole(Role.Editor, Role.Admin);

  const requests = await clipRequestRepository.findByStatus([
    RequestStatus.Submitted,
    RequestStatus.UnderReview,
  ]);

  // Load assets and notes for each request
  const rows = await Promise.all(
    requests.map(async (request) => {
      const [assets, latestNote] = await Promise.all([
        uploadedAssetRepository.findByRequestId(request.id),
        internalNoteRepository.findLatestByRequestId(request.id),
      ]);
      return { request, latestNote, assetCount: assets.length };
    })
  );

  const submitted = rows.filter((r) => r.request.status === RequestStatus.Submitted);
  const underReview = rows.filter((r) => r.request.status === RequestStatus.UnderReview);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Review Queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} request{rows.length !== 1 ? "s" : ""} awaiting review — oldest submitted first.
        </p>
      </div>

      {/* New submissions */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-800">New Submissions</h2>
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {submitted.length}
          </span>
        </div>
        <StaffRequestTable
          rows={submitted}
          columns={["title", "submitted", "assets", "latestNote"]}
          emptyMessage="No new submissions."
        />
      </section>

      {/* Under review */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-800">Under Review</h2>
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {underReview.length}
          </span>
        </div>
        <StaffRequestTable
          rows={underReview}
          columns={["title", "effort", "submitted", "dueDate", "assets", "latestNote"]}
          emptyMessage="Nothing currently under review."
        />
      </section>
    </div>
  );
}

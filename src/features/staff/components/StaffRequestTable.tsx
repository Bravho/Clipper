import Link from "next/link";
import { ClipRequest } from "@/domain/models/ClipRequest";
import { InternalNote } from "@/domain/models/InternalNote";
import { User } from "@/domain/models/User";
import { StaffStatusBadge } from "./StaffStatusBadge";
import { EFFORT_CLASS_LABELS } from "@/domain/enums/EffortClass";

interface StaffRequestRow {
  request: ClipRequest;
  requester?: User | null;
  latestNote?: InternalNote | null;
  assetCount?: number;
}

interface StaffRequestTableProps {
  rows: StaffRequestRow[];
  columns?: Array<
    | "title"
    | "requester"
    | "status"
    | "effort"
    | "submitted"
    | "dueDate"
    | "assets"
    | "latestNote"
    | "holdReason"
    | "rejectionReason"
  >;
  emptyMessage?: string;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function StaffRequestTable({
  rows,
  columns = ["title", "requester", "status", "effort", "submitted", "dueDate", "latestNote"],
  emptyMessage = "No requests found.",
}: StaffRequestTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  const showColumn = (col: string) => columns.includes(col as typeof columns[number]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              {showColumn("title") && <th className="px-4 py-3">Request</th>}
              {showColumn("requester") && <th className="px-4 py-3">Requester</th>}
              {showColumn("status") && <th className="px-4 py-3">Status</th>}
              {showColumn("effort") && <th className="px-4 py-3">Effort</th>}
              {showColumn("submitted") && <th className="px-4 py-3">Submitted</th>}
              {showColumn("dueDate") && <th className="px-4 py-3">Due Date</th>}
              {showColumn("assets") && <th className="px-4 py-3">Files</th>}
              {showColumn("latestNote") && <th className="px-4 py-3">Latest Note</th>}
              {showColumn("holdReason") && <th className="px-4 py-3">Hold Reason</th>}
              {showColumn("rejectionReason") && <th className="px-4 py-3">Rejection Reason</th>}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ request, requester, latestNote, assetCount }) => (
              <tr
                key={request.id}
                className="transition hover:bg-slate-50"
              >
                {showColumn("title") && (
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{request.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400">#{request.id}</p>
                  </td>
                )}
                {showColumn("requester") && (
                  <td className="px-4 py-3 text-slate-600">
                    {requester?.name ?? request.userId}
                    {requester?.email && (
                      <span className="ml-1 text-xs text-slate-400">
                        ({requester.email})
                      </span>
                    )}
                  </td>
                )}
                {showColumn("status") && (
                  <td className="px-4 py-3">
                    <StaffStatusBadge status={request.status} />
                  </td>
                )}
                {showColumn("effort") && (
                  <td className="px-4 py-3 text-slate-600">
                    {request.effortClass
                      ? EFFORT_CLASS_LABELS[request.effortClass]
                      : <span className="text-slate-400">—</span>}
                  </td>
                )}
                {showColumn("submitted") && (
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(request.submittedAt)}
                  </td>
                )}
                {showColumn("dueDate") && (
                  <td className="px-4 py-3">
                    {request.dueDateConfirmed && request.confirmedDueDate ? (
                      <span className={
                        request.confirmedDueDate < new Date()
                          ? "font-medium text-red-600"
                          : "text-slate-700"
                      }>
                        {formatDate(request.confirmedDueDate)}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600">Pending</span>
                    )}
                  </td>
                )}
                {showColumn("assets") && (
                  <td className="px-4 py-3 text-slate-500">
                    {assetCount != null ? assetCount : "—"}
                  </td>
                )}
                {showColumn("latestNote") && (
                  <td className="max-w-xs px-4 py-3">
                    {latestNote ? (
                      <p className="truncate text-xs text-slate-500" title={latestNote.content}>
                        {latestNote.content}
                      </p>
                    ) : (
                      <span className="text-xs text-slate-300">No notes</span>
                    )}
                  </td>
                )}
                {showColumn("holdReason") && (
                  <td className="max-w-xs px-4 py-3">
                    <p className="truncate text-xs text-amber-700" title={request.holdReason ?? ""}>
                      {request.holdReason ?? "—"}
                    </p>
                  </td>
                )}
                {showColumn("rejectionReason") && (
                  <td className="max-w-xs px-4 py-3">
                    <p className="truncate text-xs text-red-600" title={request.rejectionReason ?? ""}>
                      {request.rejectionReason ?? "—"}
                    </p>
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/staff/requests/${request.id}`}
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
  );
}

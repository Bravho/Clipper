import { RequestStatus } from "@/domain/enums/RequestStatus";

const STATUS_CONFIG: Record<
  RequestStatus,
  { label: string; className: string }
> = {
  [RequestStatus.Draft]:                  { label: "Draft",                  className: "bg-slate-100 text-slate-600" },
  [RequestStatus.Submitted]:              { label: "Submitted",              className: "bg-blue-100 text-blue-700" },
  [RequestStatus.UnderReview]:            { label: "Under Review",           className: "bg-yellow-100 text-yellow-700" },
  [RequestStatus.AcceptedForProduction]:  { label: "Accepted",               className: "bg-indigo-100 text-indigo-700" },
  [RequestStatus.Editing]:               { label: "Editing",                className: "bg-purple-100 text-purple-700" },
  [RequestStatus.ScheduledForPublishing]: { label: "Pending Admin Review",   className: "bg-orange-100 text-orange-700" },
  [RequestStatus.Published]:             { label: "Published",              className: "bg-green-100 text-green-700" },
  [RequestStatus.Delivered]:             { label: "Delivered",              className: "bg-emerald-100 text-emerald-700" },
  [RequestStatus.OnHold]:                { label: "On Hold",                className: "bg-amber-100 text-amber-700" },
  [RequestStatus.Rejected]:              { label: "Rejected",               className: "bg-red-100 text-red-700" },
  [RequestStatus.RevisionRequested]:     { label: "Revision Requested",     className: "bg-yellow-100 text-yellow-700" },
};

export function AdminStatusBadge({ status }: { status: RequestStatus }) {
  const { label, className } = STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-slate-100 text-slate-600",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

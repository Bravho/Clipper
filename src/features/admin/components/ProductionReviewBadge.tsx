import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";

const STATUS_CONFIG: Record<
  ProductionReviewStatus,
  { label: string; className: string }
> = {
  [ProductionReviewStatus.Pending]:           { label: "Pending Review",      className: "bg-orange-100 text-orange-700" },
  [ProductionReviewStatus.Approved]:          { label: "Approved",            className: "bg-green-100 text-green-700" },
  [ProductionReviewStatus.ReturnedToEditing]: { label: "Returned to Editing", className: "bg-yellow-100 text-yellow-700" },
  [ProductionReviewStatus.OnHold]:            { label: "Review On Hold",      className: "bg-amber-100 text-amber-700" },
  [ProductionReviewStatus.Rejected]:          { label: "Rejected",            className: "bg-red-100 text-red-700" },
};

export function ProductionReviewBadge({ status }: { status: ProductionReviewStatus }) {
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

import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Badge } from "@/components/ui/Badge";
import type { BadgeVariant } from "@/services/RequestPresentationService";

/**
 * Staff-facing status labels — simplified for the new workflow.
 *
 * ScheduledForPublishing → "In Production Review"
 * Published              → "Publishing"
 */
const STATUS_CONFIG: Record<RequestStatus, { label: string; variant: BadgeVariant }> = {
  [RequestStatus.Draft]:                  { label: "Draft",                 variant: "slate" },
  [RequestStatus.Submitted]:              { label: "New Request",           variant: "blue" },
  [RequestStatus.UnderReview]:            { label: "Under Review",          variant: "blue" },
  [RequestStatus.AcceptedForProduction]:  { label: "Accepted",              variant: "green" },
  [RequestStatus.Editing]:               { label: "Editing",               variant: "green" },
  [RequestStatus.ScheduledForPublishing]: { label: "In Production Review",  variant: "yellow" },
  [RequestStatus.Published]:             { label: "Publishing",            variant: "green" },
  [RequestStatus.Delivered]:             { label: "Delivered",             variant: "green" },
  [RequestStatus.OnHold]:                { label: "On Hold",               variant: "yellow" },
  [RequestStatus.Rejected]:              { label: "Rejected",              variant: "red" },
};

interface StaffStatusBadgeProps {
  status: RequestStatus;
}

export function StaffStatusBadge({ status }: StaffStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "slate" as BadgeVariant };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

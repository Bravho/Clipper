import { Badge } from "@/components/ui/Badge";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { requestPresentationService } from "@/services/RequestPresentationService";

interface RequestStatusBadgeProps {
  status: RequestStatus;
  className?: string;
}

/**
 * Renders a colour-coded badge for a request status.
 * Uses RequestPresentationService for consistent label + colour logic.
 */
export function RequestStatusBadge({
  status,
  className,
}: RequestStatusBadgeProps) {
  const { label, badgeVariant } = requestPresentationService.getStatusPresentation(status);
  return (
    <Badge variant={badgeVariant} className={className}>
      {label}
    </Badge>
  );
}

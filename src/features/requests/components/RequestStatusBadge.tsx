"use client";

import { Badge } from "@/components/ui/Badge";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { requestPresentationService } from "@/services/RequestPresentationService";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";

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
  const { t } = useI18n();
  const { badgeVariant } = requestPresentationService.getStatusPresentation(status);
  const label = t(`status.${status}` as MessageKey);
  return (
    <Badge variant={badgeVariant} className={className}>
      {label}
    </Badge>
  );
}

import { ClipRequest } from "@/domain/models/ClipRequest";
import { RequestStatusHistory } from "@/domain/models/RequestStatusHistory";
import { UploadedAsset } from "@/domain/models/UploadedAsset";
import { PublishingLink } from "@/domain/models/PublishingLink";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { PLATFORM_LABELS } from "@/domain/enums/Platform";

/**
 * RequestPresentationService — converts domain models into requester-facing
 * view-models with appropriate labels, messages, and display logic.
 *
 * This service holds all the "how should this look to the requester" logic
 * so page components stay thin and business rules stay testable.
 *
 * TODO: Staff/Admin — when staff portal is built, create a separate
 *   StaffRequestPresentationService that exposes internal operational details
 *   (raw estimated dates, queue depth, etc.) that are hidden from requesters.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type BadgeVariant = "default" | "blue" | "green" | "yellow" | "red" | "slate";

export interface StatusPresentation {
  /** Short human-readable label for badges (e.g., "In Review") */
  label: string;
  /** One-sentence explanation shown below the badge */
  description: string;
  /** Tailwind Badge variant */
  badgeVariant: BadgeVariant;
}

export interface DueDateDisplay {
  /** Whether to show a due date at all */
  show: boolean;
  /** Formatted confirmed due date string, or null */
  formattedDate: string | null;
  /** Message to show the requester */
  message: string;
}

export interface QueueDisplay {
  show: boolean;
  message: string;
}

export interface RequesterRequestView {
  id: string;
  title: string;
  status: RequestStatus;
  statusPresentation: StatusPresentation;
  creditsCost: number;
  createdAt: Date;
  submittedAt: Date | null;
  dueDateDisplay: DueDateDisplay;
  queueDisplay: QueueDisplay;
  assets: UploadedAsset[];
  publishingLinks: PublishingLink[];
  statusHistory: RequestStatusHistory[];
  holdReason: string | null;
  rejectionReason: string | null;
  /** Brief fields */
  description: string;
  targetAudience: string;
  targetPlatforms: string[]; // human-readable labels
  preferredStyle: string;
  preferredLanguage: string;
}

// ─── Status presentation map ─────────────────────────────────────────────────

const STATUS_PRESENTATION: Record<RequestStatus, StatusPresentation> = {
  [RequestStatus.Draft]: {
    label: "Draft",
    description: "Your request is saved as a draft. Complete and submit it when you're ready.",
    badgeVariant: "slate",
  },
  [RequestStatus.Submitted]: {
    label: "Submitted",
    description: "Your request has been submitted and is waiting for our team to begin review.",
    badgeVariant: "blue",
  },
  [RequestStatus.UnderReview]: {
    label: "In Review",
    description: "Our team is reviewing your brief and uploaded materials.",
    badgeVariant: "blue",
  },
  [RequestStatus.AcceptedForProduction]: {
    label: "Accepted",
    description: "Your request has been accepted and is queued for production.",
    badgeVariant: "green",
  },
  [RequestStatus.Editing]: {
    label: "In Production",
    description: "Your clip is currently being edited by our team.",
    badgeVariant: "green",
  },
  [RequestStatus.ScheduledForPublishing]: {
    label: "Scheduled",
    description: "Production is complete. Your clip is being prepared for publishing.",
    badgeVariant: "green",
  },
  [RequestStatus.Published]: {
    label: "Published",
    description: "Your clip has been published to the selected platforms.",
    badgeVariant: "green",
  },
  [RequestStatus.Delivered]: {
    label: "Delivered",
    description: "Your clip has been delivered. You can view and share the links below.",
    badgeVariant: "green",
  },
  [RequestStatus.OnHold]: {
    label: "On Hold",
    description: "Your request is currently on hold. Please see the reason below.",
    badgeVariant: "yellow",
  },
  [RequestStatus.Rejected]: {
    label: "Rejected",
    description: "Your request could not be fulfilled. Please see the reason below.",
    badgeVariant: "red",
  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

export class RequestPresentationService {
  /** Get the status presentation for a given status. */
  getStatusPresentation(status: RequestStatus): StatusPresentation {
    return STATUS_PRESENTATION[status];
  }

  /**
   * Build the requester-facing due date display message.
   *
   * Business rules:
   * - Draft / Submitted: No due date message (too early).
   * - UnderReview: Pending confirmation message.
   * - AcceptedForProduction / Editing / Scheduled: Show confirmed date if available,
   *   otherwise show pending message.
   * - Published / Delivered: Show confirmed date as reference.
   * - OnHold / Rejected: Due date not applicable.
   */
  getDueDateDisplay(request: ClipRequest): DueDateDisplay {
    const { status, dueDateConfirmed, confirmedDueDate } = request;

    // Draft and Submitted — too early to show anything
    if (
      status === RequestStatus.Draft ||
      status === RequestStatus.Submitted
    ) {
      return { show: false, formattedDate: null, message: "" };
    }

    // Terminal / hold / reject — not applicable
    if (
      status === RequestStatus.OnHold ||
      status === RequestStatus.Rejected
    ) {
      return {
        show: false,
        formattedDate: null,
        message: "Due date is not applicable for this request.",
      };
    }

    // Confirmed date available
    if (dueDateConfirmed && confirmedDueDate) {
      const formatted = this.formatDate(confirmedDueDate);
      const isPast = confirmedDueDate < new Date();

      if (
        status === RequestStatus.Published ||
        status === RequestStatus.Delivered
      ) {
        return {
          show: true,
          formattedDate: formatted,
          message: `Completed by ${formatted}.`,
        };
      }

      return {
        show: true,
        formattedDate: formatted,
        message: isPast
          ? `Expected by ${formatted} — our team is finalising your clip.`
          : `Expected completion: ${formatted}.`,
      };
    }

    // Under review or accepted but no confirmed date yet
    return {
      show: true,
      formattedDate: null,
      message:
        "Your request is under review. An expected completion date will appear here once our team confirms production timing.",
    };
  }

  /**
   * Build the requester-facing queue display message.
   * Requesters see a simplified version — no internal queue depth or staff detail.
   */
  getQueueDisplay(request: ClipRequest): QueueDisplay {
    const { status, queuePosition } = request;

    switch (status) {
      case RequestStatus.Draft:
        return { show: false, message: "" };

      case RequestStatus.Submitted:
        return {
          show: true,
          message:
            queuePosition != null
              ? `Your request is in the queue (approximately ${queuePosition} ahead of yours).`
              : "Your request has been submitted and is waiting for review.",
        };

      case RequestStatus.UnderReview:
        return {
          show: true,
          message: "Our team is currently reviewing your brief and materials.",
        };

      case RequestStatus.AcceptedForProduction:
        return {
          show: true,
          message:
            queuePosition === 1
              ? "Your request is next in the production queue."
              : "Your request has been accepted and is queued for production.",
        };

      case RequestStatus.Editing:
        return {
          show: true,
          message: "Your clip is currently being produced by our team.",
        };

      case RequestStatus.ScheduledForPublishing:
        return {
          show: true,
          message: "Production is complete. Publishing is being arranged.",
        };

      case RequestStatus.Published:
      case RequestStatus.Delivered:
        return { show: false, message: "" };

      case RequestStatus.OnHold:
        return {
          show: true,
          message:
            "Your request is on hold. Production will resume once the issue is resolved.",
        };

      case RequestStatus.Rejected:
        return { show: false, message: "" };

      default:
        return { show: false, message: "" };
    }
  }

  /**
   * Build a full RequesterRequestView from domain model parts.
   * This is the primary method used by the Request Detail page.
   */
  buildRequestView(
    request: ClipRequest,
    assets: UploadedAsset[],
    publishingLinks: PublishingLink[],
    statusHistory: RequestStatusHistory[]
  ): RequesterRequestView {
    return {
      id: request.id,
      title: request.title,
      status: request.status,
      statusPresentation: this.getStatusPresentation(request.status),
      creditsCost: request.creditsCost,
      createdAt: request.createdAt,
      submittedAt: request.submittedAt,
      dueDateDisplay: this.getDueDateDisplay(request),
      queueDisplay: this.getQueueDisplay(request),
      assets,
      publishingLinks,
      statusHistory,
      holdReason: request.holdReason,
      rejectionReason: request.rejectionReason,
      description: request.description,
      targetAudience: request.targetAudience,
      targetPlatforms: request.targetPlatforms.map(
        (p) => PLATFORM_LABELS[p] ?? p
      ),
      preferredStyle: request.preferredStyle,
      preferredLanguage: request.preferredLanguage,
    };
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
}

// Singleton instance
export const requestPresentationService = new RequestPresentationService();

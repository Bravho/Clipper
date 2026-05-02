import { ClipRequest } from "@/domain/models/ClipRequest";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { EffortClass, EFFORT_CLASS_LABELS } from "@/domain/enums/EffortClass";
import { UploadedAsset } from "@/domain/models/UploadedAsset";
import { PublishingLink } from "@/domain/models/PublishingLink";
import { RequestStatusHistory } from "@/domain/models/RequestStatusHistory";
import { InternalNote } from "@/domain/models/InternalNote";
import { PLATFORM_LABELS } from "@/domain/enums/Platform";
import { BadgeVariant } from "@/services/RequestPresentationService";

/**
 * StaffRequestPresentationService — builds staff-facing view models from domain entities.
 *
 * Unlike RequestPresentationService (which is requester-facing and hides internal details),
 * this service exposes:
 * - Internal system estimates (estimatedDueDate)
 * - Effort classifications
 * - CapCut workflow fields
 * - Full queue context
 * - Operational next-action guidance
 *
 * IMPORTANT: Never return data from this service in requester-facing API routes.
 *
 * TODO: Admin Portal — admins get a superset of this view with
 *   requester account details, financial records, and system capacity context.
 */

export interface StaffStatusPresentation {
  label: string;
  operationalDescription: string;
  badgeVariant: BadgeVariant;
  nextActions: StaffAction[];
}

export interface StaffAction {
  label: string;
  action: string;           // Action identifier (used by client components)
  variant: "primary" | "secondary" | "danger" | "warning";
  requiresInput?: boolean;  // True if action needs additional input (reason field, date, etc.)
}

export interface StaffRequestView {
  id: string;
  title: string;
  description: string;
  targetAudience: string;
  targetPlatforms: string[];      // Human-readable labels
  preferredStyle: string;
  preferredLanguage: string;

  // Requester info
  userId: string;

  // Status
  status: RequestStatus;
  statusPresentation: StaffStatusPresentation;
  creditsCost: number;

  // Timestamps
  createdAt: Date;
  submittedAt: Date | null;
  updatedAt: Date;

  // Due date — all details exposed to staff
  estimatedDueDate: Date | null;
  confirmedDueDate: Date | null;
  dueDateConfirmed: boolean;
  isOverdue: boolean;
  daysRemaining: number | null;

  // Hold / Reject
  holdReason: string | null;
  rejectionReason: string | null;

  // Staff-specific
  effortClass: EffortClass | null;
  effortClassLabel: string | null;

  // Related data
  assets: UploadedAsset[];
  publishingLinks: PublishingLink[];
  statusHistory: RequestStatusHistory[];
  internalNotes: InternalNote[];
  latestNote: InternalNote | null;
}

// ── Status presentation map ────────────────────────────────────────────────

const STAFF_STATUS_PRESENTATION: Record<RequestStatus, Omit<StaffStatusPresentation, "nextActions">> = {
  [RequestStatus.Draft]: {
    label: "Draft",
    operationalDescription: "Requester is still completing the form. No action needed.",
    badgeVariant: "slate",
  },
  [RequestStatus.Submitted]: {
    label: "New Request",
    operationalDescription: "New submission awaiting acceptance. Confirm due date and effort class, then accept to start editing.",
    badgeVariant: "blue",
  },
  [RequestStatus.UnderReview]: {
    label: "Under Review",
    operationalDescription: "Under review (legacy status).",
    badgeVariant: "blue",
  },
  [RequestStatus.AcceptedForProduction]: {
    label: "Accepted",
    operationalDescription: "Accepted for production (legacy status).",
    badgeVariant: "green",
  },
  [RequestStatus.Editing]: {
    label: "Editing",
    operationalDescription: "Active editing in progress. Upload the final edited clip, then submit for production review.",
    badgeVariant: "green",
  },
  [RequestStatus.ScheduledForPublishing]: {
    label: "In Production Review",
    operationalDescription: "Submitted for admin production review. Admin will approve for publishing or return to editing with revision notes.",
    badgeVariant: "yellow",
  },
  [RequestStatus.Published]: {
    label: "Publishing",
    operationalDescription: "Approved for publishing. Add publishing links for each target platform, then mark Delivered once all links are confirmed.",
    badgeVariant: "green",
  },
  [RequestStatus.Delivered]: {
    label: "Delivered",
    operationalDescription: "Delivery confirmed. No further action required.",
    badgeVariant: "green",
  },
  [RequestStatus.OnHold]: {
    label: "On Hold",
    operationalDescription: "Request is paused. Awaiting resolution. Resume to return it to the editing queue.",
    badgeVariant: "yellow",
  },
  [RequestStatus.Rejected]: {
    label: "Rejected",
    operationalDescription: "Request was previously rejected. Any staff member can re-accept it to start editing.",
    badgeVariant: "red",
  },
};

// ── Next actions per status ────────────────────────────────────────────────

function getNextActions(status: RequestStatus): StaffAction[] {
  switch (status) {
    case RequestStatus.Submitted:
      return [
        { label: "Accept & Start Editing", action: "accept_and_start_editing", variant: "primary", requiresInput: true },
        { label: "Put On Hold", action: "put_on_hold", variant: "warning", requiresInput: true },
        { label: "Reject Request", action: "reject", variant: "danger", requiresInput: true },
      ];
    case RequestStatus.Editing:
      return [
        { label: "Submit for Production Review", action: "submit_for_production_review", variant: "primary" },
        { label: "Put On Hold", action: "put_on_hold", variant: "warning", requiresInput: true },
        { label: "Reject Request", action: "reject", variant: "danger", requiresInput: true },
      ];
    case RequestStatus.ScheduledForPublishing:
      return [
        { label: "Approve for Publishing", action: "approve_for_publishing", variant: "primary" },
        { label: "Return to Editing", action: "return_to_editing", variant: "secondary", requiresInput: true },
        { label: "Put On Hold", action: "put_on_hold", variant: "warning", requiresInput: true },
      ];
    case RequestStatus.Published:
      return [
        { label: "Mark Delivered", action: "mark_delivered", variant: "primary" },
        { label: "Add Publishing Link", action: "add_link", variant: "secondary", requiresInput: true },
      ];
    case RequestStatus.OnHold:
      return [
        { label: "Resume (Return to Queue)", action: "resume_from_hold", variant: "primary" },
        { label: "Reject Request", action: "reject", variant: "danger", requiresInput: true },
      ];
    case RequestStatus.Rejected:
      return [
        { label: "Re-accept & Start Editing", action: "accept_and_start_editing", variant: "primary", requiresInput: true },
      ];
    case RequestStatus.Draft:
    case RequestStatus.UnderReview:
    case RequestStatus.AcceptedForProduction:
    case RequestStatus.Delivered:
      return [];
  }
}

// ── Service class ─────────────────────────────────────────────────────────────

export class StaffRequestPresentationService {
  getStatusPresentation(status: RequestStatus): StaffStatusPresentation {
    return {
      ...STAFF_STATUS_PRESENTATION[status],
      nextActions: getNextActions(status),
    };
  }

  buildRequestView(
    request: ClipRequest,
    assets: UploadedAsset[],
    publishingLinks: PublishingLink[],
    statusHistory: RequestStatusHistory[],
    internalNotes: InternalNote[]
  ): StaffRequestView {
    const now = new Date();
    const confirmedDate = request.confirmedDueDate;
    const isOverdue = !!confirmedDate && confirmedDate < now &&
      ![RequestStatus.Delivered, RequestStatus.Rejected].includes(request.status);

    let daysRemaining: number | null = null;
    if (confirmedDate && !isOverdue) {
      const diff = confirmedDate.getTime() - now.getTime();
      daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    const effortClass = request.effortClass ?? null;

    return {
      id: request.id,
      title: request.title,
      description: request.description,
      targetAudience: request.targetAudience,
      targetPlatforms: request.targetPlatforms.map((p) => PLATFORM_LABELS[p] ?? p),
      preferredStyle: request.preferredStyle,
      preferredLanguage: request.preferredLanguage,
      userId: request.userId,
      status: request.status,
      statusPresentation: this.getStatusPresentation(request.status),
      creditsCost: request.creditsCost,
      createdAt: request.createdAt,
      submittedAt: request.submittedAt,
      updatedAt: request.updatedAt,
      estimatedDueDate: request.estimatedDueDate,
      confirmedDueDate: confirmedDate,
      dueDateConfirmed: request.dueDateConfirmed,
      isOverdue,
      daysRemaining,
      holdReason: request.holdReason,
      rejectionReason: request.rejectionReason,
      effortClass,
      effortClassLabel: effortClass ? EFFORT_CLASS_LABELS[effortClass] : null,
      assets,
      publishingLinks,
      statusHistory: [...statusHistory].sort(
        (a, b) => b.changedAt.getTime() - a.changedAt.getTime()
      ),
      internalNotes: [...internalNotes].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      ),
      latestNote: internalNotes.length > 0
        ? [...internalNotes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
        : null,
    };
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  formatRelativeDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return this.formatDate(date);
  }
}

// Singleton instance
export const staffRequestPresentationService = new StaffRequestPresentationService();

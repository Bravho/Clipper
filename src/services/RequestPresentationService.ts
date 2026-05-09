import { ClipRequest } from "@/domain/models/ClipRequest";
import { RequestStatusHistory } from "@/domain/models/RequestStatusHistory";
import { UploadedAsset } from "@/domain/models/UploadedAsset";
import { PublishingLink } from "@/domain/models/PublishingLink";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { PLATFORM_LABELS } from "@/domain/enums/Platform";
import {
  VideoGenerationStep,
  PIPELINE_STEP_LABELS,
  PIPELINE_STEP_DESCRIPTIONS,
} from "@/domain/enums/VideoGenerationStep";

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
  /** Pipeline progress — only present when status is Editing and a pipeline job exists. */
  pipelineProgress: {
    step: VideoGenerationStep;
    label: string;
    description: string;
  } | null;
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
    label: "แบบร่าง",
    description: "คำขอของคุณถูกบันทึกเป็นแบบร่าง กรอกข้อมูลให้ครบแล้วส่งเมื่อพร้อม",
    badgeVariant: "slate",
  },
  [RequestStatus.Submitted]: {
    label: "ส่งแล้ว",
    description: "คำขอของคุณถูกส่งแล้วและรอทีมงานเริ่มตรวจสอบ",
    badgeVariant: "blue",
  },
  [RequestStatus.UnderReview]: {
    label: "กำลังตรวจสอบ",
    description: "ทีมงานกำลังตรวจสอบ brief และไฟล์ที่อัพโหลด",
    badgeVariant: "blue",
  },
  [RequestStatus.AcceptedForProduction]: {
    label: "รับงานแล้ว",
    description: "คำขอของคุณได้รับการยอมรับและอยู่ในคิวการผลิต",
    badgeVariant: "green",
  },
  [RequestStatus.Editing]: {
    label: "กำลังผลิต",
    description: "คลิปของคุณกำลังถูกตัดต่อโดยทีมงาน",
    badgeVariant: "green",
  },
  [RequestStatus.ScheduledForPublishing]: {
    label: "กำหนดเผยแพร่แล้ว",
    description: "การผลิตเสร็จสิ้นแล้ว คลิปของคุณกำลังเตรียมพร้อมสำหรับการเผยแพร่",
    badgeVariant: "green",
  },
  [RequestStatus.Published]: {
    label: "เผยแพร่แล้ว",
    description: "คลิปของคุณถูกเผยแพร่ไปยังช่องทางที่เลือกแล้ว",
    badgeVariant: "green",
  },
  [RequestStatus.Delivered]: {
    label: "ส่งมอบแล้ว",
    description: "คลิปของคุณถูกส่งมอบแล้ว ดูและแชร์ลิงก์ด้านล่างได้เลย",
    badgeVariant: "green",
  },
  [RequestStatus.OnHold]: {
    label: "พักไว้ชั่วคราว",
    description: "คำขอของคุณถูกพักไว้ชั่วคราว กรุณาดูเหตุผลด้านล่าง",
    badgeVariant: "yellow",
  },
  [RequestStatus.Rejected]: {
    label: "ปฏิเสธ",
    description: "ไม่สามารถดำเนินการตามคำขอของคุณได้ กรุณาดูเหตุผลด้านล่าง",
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
        message: "ไม่มีกำหนดส่งสำหรับคำขอนี้",
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
          message: `เสร็จสิ้นเมื่อ ${formatted}`,
        };
      }

      return {
        show: true,
        formattedDate: formatted,
        message: isPast
          ? `คาดว่าเสร็จภายใน ${formatted} — ทีมงานกำลังสรุปคลิปของคุณ`
          : `คาดว่าเสร็จภายใน: ${formatted}`,
      };
    }

    // Under review or accepted but no confirmed date yet
    return {
      show: true,
      formattedDate: null,
      message:
        "คำขอของคุณอยู่ระหว่างการตรวจสอบ วันที่คาดว่าจะเสร็จจะแสดงที่นี่เมื่อทีมงานยืนยันกำหนดการผลิต",
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
              ? `คำขอของคุณอยู่ในคิว (มีประมาณ ${queuePosition} คำขออยู่ก่อนหน้า)`
              : "คำขอของคุณถูกส่งแล้วและรอการตรวจสอบ",
        };

      case RequestStatus.UnderReview:
        return {
          show: true,
          message: "ทีมงานกำลังตรวจสอบ brief และไฟล์ของคุณ",
        };

      case RequestStatus.AcceptedForProduction:
        return {
          show: true,
          message:
            queuePosition === 1
              ? "คำขอของคุณเป็นลำดับถัดไปในคิวการผลิต"
              : "คำขอของคุณได้รับการยอมรับและอยู่ในคิวการผลิต",
        };

      case RequestStatus.Editing:
        return {
          show: true,
          message: "คลิปของคุณกำลังถูกผลิตโดยทีมงาน",
        };

      case RequestStatus.ScheduledForPublishing:
        return {
          show: true,
          message: "การผลิตเสร็จสิ้นแล้ว กำลังจัดเตรียมการเผยแพร่",
        };

      case RequestStatus.Published:
      case RequestStatus.Delivered:
        return { show: false, message: "" };

      case RequestStatus.OnHold:
        return {
          show: true,
          message: "คำขอของคุณถูกพักไว้ชั่วคราว การผลิตจะดำเนินต่อเมื่อแก้ไขปัญหาแล้ว",
        };

      case RequestStatus.Rejected:
        return { show: false, message: "" };

      default:
        return { show: false, message: "" };
    }
  }

  /** Build pipeline progress display for the requester (only during Editing). */
  getPipelineProgress(
    status: RequestStatus,
    pipelineStep: VideoGenerationStep | null
  ): RequesterRequestView["pipelineProgress"] {
    if (status !== RequestStatus.Editing || !pipelineStep) return null;
    return {
      step: pipelineStep,
      label: PIPELINE_STEP_LABELS[pipelineStep],
      description: PIPELINE_STEP_DESCRIPTIONS[pipelineStep],
    };
  }

  /**
   * Build a full RequesterRequestView from domain model parts.
   * This is the primary method used by the Request Detail page.
   *
   * @param pipelineStep  Optional current VideoGenerationStep — shown during Editing status.
   */
  buildRequestView(
    request: ClipRequest,
    assets: UploadedAsset[],
    publishingLinks: PublishingLink[],
    statusHistory: RequestStatusHistory[],
    pipelineStep: VideoGenerationStep | null = null
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
      pipelineProgress: this.getPipelineProgress(request.status, pipelineStep),
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
    return date.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
}

// Singleton instance
export const requestPresentationService = new RequestPresentationService();

import { RequestStatus } from "@/domain/enums/RequestStatus";
import {
  FINAL_CLIP_AVAILABILITY_DAYS,
  INACTIVITY_CANCEL_DAYS,
  addDays,
} from "@/config/retention";
import { estimatedSpaceExpiry } from "@/config/spacesLifecycle";

/**
 * Inline retention text notes (Thai) rendered in the page — NOT emails or
 * popups. Each note is derived from data the request already carries (status +
 * updatedAt), so no notification service is involved.
 *
 * `updatedAt` is used as a proxy for both "delivered at" (once the request is in
 * a terminal delivered/published state) and "last activity" (while active). A
 * dedicated `deliveredAt` / `lastActivityAt` column would be more precise; see
 * the design doc's open items.
 */

export interface RetentionNote {
  /** Text to show inline. */
  text: string;
  /** The moment the described deletion/cancellation happens, if applicable. */
  effectiveAt: Date | null;
  /** Severity hint for styling: info | warning | expired. */
  tone: "info" | "warning" | "expired";
}

interface RequestLike {
  status: RequestStatus;
  updatedAt: Date;
}

function formatThaiDate(date: Date): string {
  return date.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Note for the final video / download button — the 7-day availability window.
 * Returns null when the request is not in a delivered/published state.
 */
export function finalClipAvailabilityNote(
  request: RequestLike,
  now: Date = new Date()
): RetentionNote | null {
  const delivered =
    request.status === RequestStatus.Delivered ||
    request.status === RequestStatus.Published;
  if (!delivered) return null;

  const expiresAt = addDays(request.updatedAt, FINAL_CLIP_AVAILABILITY_DAYS);
  const remaining = daysUntil(expiresAt, now);

  if (remaining <= 0) {
    return {
      text: "ไฟล์วิดีโอหมดอายุการดาวน์โหลดแล้ว",
      effectiveAt: expiresAt,
      tone: "expired",
    };
  }
  if (remaining <= 1) {
    return {
      text: "วิดีโอจะถูกลบภายในวันนี้ กรุณาดาวน์โหลดทันที",
      effectiveAt: expiresAt,
      tone: "warning",
    };
  }
  return {
    text: `ดาวน์โหลดได้ถึง ${formatThaiDate(expiresAt)} (อีก ${remaining} วัน)`,
    effectiveAt: expiresAt,
    tone: remaining <= 2 ? "warning" : "info",
  };
}

/**
 * Note for the request header while it is active — the inactivity auto-cancel
 * countdown — or, once auto-cancelled, the deletion notice. Returns null when
 * not applicable (drafts, other terminal states).
 */
export function inactivityNote(
  request: RequestLike,
  now: Date = new Date()
): RetentionNote | null {
  if (request.status === RequestStatus.AutoCancelled) {
    return {
      text: "ยกเลิกอัตโนมัติ (ไม่มีการเคลื่อนไหว 30 วัน) — ไฟล์ที่อัพโหลดและไฟล์ที่ประมวลผลถูกลบแล้ว",
      effectiveAt: null,
      tone: "expired",
    };
  }

  const active: RequestStatus[] = [
    RequestStatus.Submitted,
    RequestStatus.UnderReview,
    RequestStatus.AcceptedForProduction,
    RequestStatus.Editing,
    RequestStatus.ScheduledForPublishing,
    RequestStatus.OnHold,
    RequestStatus.RevisionRequested,
  ];
  if (!active.includes(request.status)) return null;

  const cancelAt = addDays(request.updatedAt, INACTIVITY_CANCEL_DAYS);
  const remaining = daysUntil(cancelAt, now);

  // Only surface the warning as the cutoff approaches (last week).
  if (remaining > 7) return null;

  return {
    text:
      remaining <= 0
        ? "คำขอนี้ไม่มีการเคลื่อนไหวและกำลังจะถูกยกเลิกอัตโนมัติ"
        : `ไม่มีการเคลื่อนไหว — จะถูกยกเลิกอัตโนมัติในวันที่ ${formatThaiDate(cancelAt)} (อีก ${remaining} วัน)`,
    effectiveAt: cancelAt,
    tone: "warning",
  };
}

/** Static note for the uploaded images/videos section. */
export function uploadedMaterialsNote(): RetentionNote {
  return {
    text: "ไฟล์ต้นฉบับที่อัพโหลดจะถูกเก็บไว้จนกว่าคำขอจะส่งมอบ หรือไม่มีการเคลื่อนไหวครบ 30 วัน",
    effectiveAt: null,
    tone: "info",
  };
}

/**
 * Note for a single stored media object, derived from its storage-key lifecycle
 * window (see {@link estimatedSpaceExpiry}). Used at the final-approval step for
 * the intermediate un-captioned "master" merged video so the requester knows
 * when its stored file will be purged and can continue before then. The note
 * never tells the requester to download: this master is an intermediate step
 * with no download action, and downloads exist only on the final subtitled /
 * motion-graphic exports.
 *
 * `baseline` is the object's creation time (the asset's `createdAt`). Returns
 * null when the key has no lifecycle rule or no baseline is available.
 */
export function spaceExpiryNote(
  storageKey: string | null | undefined,
  baseline: Date | string | null | undefined,
  now: Date = new Date()
): RetentionNote | null {
  const base =
    baseline instanceof Date
      ? baseline
      : baseline
        ? new Date(baseline)
        : null;
  if (base && Number.isNaN(base.getTime())) return null;

  const expiresAt = estimatedSpaceExpiry(storageKey, base);
  if (!expiresAt) return null;

  const remaining = daysUntil(expiresAt, now);
  if (remaining <= 0) {
    return {
      text: `ไฟล์วิดีโอนี้หมดอายุการจัดเก็บแล้ว (${formatThaiDate(expiresAt)})`,
      effectiveAt: expiresAt,
      tone: "expired",
    };
  }
  return {
    text: `ไฟล์วิดีโอที่รวมเสียงนี้จะถูกเก็บไว้ถึงประมาณ ${formatThaiDate(expiresAt)} (อีก ${remaining} วัน) — กรุณาดำเนินการขั้นตอนต่อไปก่อนหมดเวลา`,
    effectiveAt: expiresAt,
    tone: remaining <= 2 ? "warning" : "info",
  };
}

import { z } from "zod";
import { Platform } from "@/domain/enums/Platform";
import { EffortClass } from "@/domain/enums/EffortClass";

/**
 * Validation schemas for staff workflow action API routes.
 *
 * Used in:
 * - /api/staff/requests/[id]/review
 * - /api/staff/requests/[id]/accept
 * - /api/staff/requests/[id]/hold
 * - /api/staff/requests/[id]/reject
 * - /api/staff/requests/[id]/due-date
 * - /api/staff/requests/[id]/editing
 * - /api/staff/requests/[id]/schedule
 * - /api/staff/requests/[id]/publish
 * - /api/staff/requests/[id]/deliver
 * - /api/staff/requests/[id]/resume
 * - /api/staff/requests/[id]/progress
 * - /api/staff/notes/[requestId]
 */

/** Optional staff note to attach to a status transition. */
const optionalNote = z
  .string()
  .trim()
  .max(1000, "Note must be under 1000 characters.")
  .optional();

/** Shared: required reason field for hold/reject. */
const requiredReason = z
  .string()
  .trim()
  .min(10, "Please provide a meaningful reason (at least 10 characters).")
  .max(2000, "Reason must be under 2000 characters.");

// ── Transition schemas (simple — just an optional note) ────────────────────

export const markUnderReviewSchema = z.object({ note: optionalNote });
export const acceptForProductionSchema = z.object({ note: optionalNote });
export const moveToEditingSchema = z.object({ note: optionalNote });
export const scheduleForPublishingSchema = z.object({ note: optionalNote });
export const markPublishedSchema = z.object({ note: optionalNote });
export const markDeliveredSchema = z.object({ note: optionalNote });
export const resumeFromHoldSchema = z.object({ note: optionalNote });

// ── Hold / Reject schemas ──────────────────────────────────────────────────

export const putOnHoldSchema = z.object({
  holdReason: requiredReason,
  note: optionalNote,
});

export const rejectRequestSchema = z.object({
  rejectionReason: requiredReason,
  note: optionalNote,
});

// ── Due date confirmation schema ───────────────────────────────────────────

export const confirmDueDateSchema = z.object({
  /** ISO date string for the confirmed due date. */
  confirmedDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format."),
  note: optionalNote,
});

// ── Effort class schema ────────────────────────────────────────────────────

export const updateEffortClassSchema = z.object({
  effortClass: z.nativeEnum(EffortClass, { message: "Invalid effort class." }),
});

// ── Publishing link schema ─────────────────────────────────────────────────

export const addPublishingLinkSchema = z.object({
  platform: z.nativeEnum(Platform, { message: "Invalid platform." }),
  url: z.string().trim().url("Must be a valid URL.").max(2000),
});

// ── Internal note schema ───────────────────────────────────────────────────

export const addInternalNoteSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Note content is required.")
    .max(2000, "Notes cannot exceed 2000 characters."),
});

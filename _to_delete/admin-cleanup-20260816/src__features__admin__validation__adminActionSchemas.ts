import { z } from "zod";

/**
 * Zod validation schemas for admin workflow API inputs.
 * Used by both API route handlers and client-side forms.
 */

export const approveForPublishingSchema = z.object({
  reviewNote: z.string().max(1000).optional(),
});

export const returnToEditingSchema = z.object({
  revisionNote: z
    .string()
    .min(5, "Please provide a clear revision note for staff.")
    .max(1000),
});

export const holdDuringReviewSchema = z.object({
  holdReason: z
    .string()
    .min(5, "Please provide a hold reason (shown to requester).")
    .max(500),
  reviewNote: z.string().max(1000).optional(),
});

export const rejectFromReviewSchema = z.object({
  rejectionReason: z
    .string()
    .min(5, "Please provide a rejection reason (shown to requester).")
    .max(500),
  reviewNote: z.string().max(1000).optional(),
});

export type ApproveForPublishingInput = z.infer<typeof approveForPublishingSchema>;
export type ReturnToEditingInput = z.infer<typeof returnToEditingSchema>;
export type HoldDuringReviewInput = z.infer<typeof holdDuringReviewSchema>;
export type RejectFromReviewInput = z.infer<typeof rejectFromReviewSchema>;

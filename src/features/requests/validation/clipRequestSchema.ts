import { z } from "zod";
import { Platform } from "@/domain/enums/Platform";
import { MAX_UPLOAD_COUNT } from "@/domain/enums/AssetType";
import { PIPELINE_STEP_COSTS } from "@/config/credits";

/**
 * Zod schema for the clip request submission form.
 *
 * This is the single source of validation truth for the requester form.
 * Used by:
 * - Client-side react-hook-form (zodResolver)
 * - Server-side API route validation
 *
 * Business rules enforced:
 * - Max 5 file attachments (validated separately via upload count)
 * - At least 1 target platform required (Tvent always pre-selected in UI)
 * - Both legal confirmations required before submission
 * - preferredStyle and preferredLanguage are not collected on the form (removed per product decision)
 */

const platformValues = Object.values(Platform) as [Platform, ...Platform[]];

export const clipRequestFormSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters.")
    .max(100, "Title must be 100 characters or fewer."),

  description: z
    .string()
    .min(20, "Please provide a description of at least 20 characters.")
    .max(2000, "Description must be 2000 characters or fewer."),

  targetAudience: z
    .string()
    .max(500, "Target audience must be 500 characters or fewer.")
    .optional()
    .default(""),

  targetPlatforms: z
    .array(z.enum(platformValues))
    .min(1, "Please select at least one platform."),

  durationSeconds: z.coerce
    .number({ invalid_type_error: "กรุณาระบุความยาววิดีโอ" })
    .int("ต้องเป็นจำนวนเต็มวินาที")
    .min(
      PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS,
      `ความยาววิดีโอขั้นต่ำ ${PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS} วินาที`
    )
    .max(
      PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS,
      `ความยาววิดีโอสูงสุด ${PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS} วินาที`
    ),
});

/** Schema for draft saves — legal confirmations not required yet. */
export const draftClipRequestSchema = clipRequestFormSchema.partial();

/** Schema for final submission — adds required legal confirmations. */
export const submitClipRequestSchema = clipRequestFormSchema.extend({
  creditConfirmed: z.literal(true, {
    errorMap: () => ({
      message: "You must confirm you understand the credit cost for this request.",
    }),
  }),
  rightsConfirmed: z.literal(true, {
    errorMap: () => ({
      message:
        "You must confirm you have the rights to submit these materials.",
    }),
  }),
});

export type ClipRequestFormValues = z.infer<typeof clipRequestFormSchema>;
export type DraftClipRequestValues = z.infer<typeof draftClipRequestSchema>;
export type SubmitClipRequestValues = z.infer<typeof submitClipRequestSchema>;

// ── Upload count validation (separate from the form schema) ──────────────────

/** Returns a validation error message if the upload count exceeds the limit. */
export function validateUploadCount(count: number): string | null {
  if (count > MAX_UPLOAD_COUNT) {
    return `You may attach a maximum of ${MAX_UPLOAD_COUNT} files per request.`;
  }
  return null;
}

// STYLE_OPTIONS removed — preferred style is no longer collected on the form.
// LANGUAGE_OPTIONS removed — preferred language is no longer collected on the form.

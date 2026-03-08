import { z } from "zod";
import { Platform } from "@/domain/enums/Platform";
import { MAX_UPLOAD_COUNT } from "@/domain/enums/AssetType";

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
 * - Exactly 1 target platform required (radio button — single select)
 * - Both legal confirmations required before submission
 * - preferredLanguage is not collected on the form (removed per product decision)
 */

// Allowed platform values from the enum
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
    .min(5, "Please describe your target audience.")
    .max(500, "Target audience must be 500 characters or fewer."),

  // Radio button — exactly 1 platform stored as a single-item array
  // to remain compatible with the TEXT[] DB column.
  targetPlatforms: z
    .array(z.enum(platformValues))
    .length(1, "Please select a target platform."),

  preferredStyle: z
    .string()
    .min(1, "Please choose a preferred style."),
});

/** Schema for draft saves — legal confirmations not required yet. */
export const draftClipRequestSchema = clipRequestFormSchema.partial();

/** Schema for final submission — adds required legal confirmations. */
export const submitClipRequestSchema = clipRequestFormSchema.extend({
  creditConfirmed: z.literal(true, {
    errorMap: () => ({
      message: "You must confirm you understand this request uses 10 credits.",
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

// ── Style and language options ───────────────────────────────────────────────

export const STYLE_OPTIONS = [
  { value: "Dynamic / Energetic", label: "Dynamic / Energetic" },
  { value: "Calm / Informative", label: "Calm / Informative" },
  { value: "Fun / Playful", label: "Fun / Playful" },
  { value: "Professional / Corporate", label: "Professional / Corporate" },
  { value: "Cinematic / Dramatic", label: "Cinematic / Dramatic" },
  { value: "Minimalist / Clean", label: "Minimalist / Clean" },
] as const;

// LANGUAGE_OPTIONS removed — preferred language is no longer collected on the form.

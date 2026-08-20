import { z } from "zod";
import {
  FEEDBACK_REASONS,
  SAFETY_REASONS,
  type FeedbackReportStatus,
  type FeedbackReportType,
} from "@/services/admin/AdminFeedbackService";

/**
 * Request-body schemas for the feedback triage endpoints, plus the search-param
 * coercion the page needs.
 *
 * The triage bodies are tiny — two of the three routes accept nothing but an
 * optional note — but they are parsed rather than hand-read so the note's length
 * cap is enforced in one place and a caller who posts a 50 kB "note" gets a 400
 * with a real message instead of a Postgres error.
 */

/**
 * Notes are stored in `resolution_note` (unbounded TEXT). The cap matches the
 * 2000 chars the requester-side report form already enforces on `details`;
 * there is no reason for an admin's closing note to be longer than the report.
 */
const MAX_NOTE_LENGTH = 2000;

const noteField = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH, `Note must be ${MAX_NOTE_LENGTH} characters or fewer.`)
  .optional();

/**
 * POST .../review — no body.
 *
 * Still parsed (rather than ignored) so that a future field cannot be added on
 * the client and silently dropped here. `passthrough` is deliberately NOT used.
 */
export const startReviewSchema = z.object({}).strip();

/** POST .../resolve — optional closing note. */
export const resolveReportSchema = z.object({ note: noteField });

/** POST .../dismiss — optional reason for dismissal (spam, duplicate, …). */
export const dismissReportSchema = z.object({ note: noteField });

export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type DismissReportInput = z.infer<typeof dismissReportSchema>;

/** The list filters, as they appear in the page's query string. */
export const reportTypeParam = z.enum(["feedback", "safety"]);
export const statusParam = z.enum(["open", "reviewing", "resolved", "dismissed", "all"]);
export const reasonParam = z.enum([...SAFETY_REASONS, ...FEEDBACK_REASONS]);

/**
 * Read one search param, falling back rather than erroring.
 *
 * An admin who hand-edits `?status=oepn` should see the default view, not a
 * stack trace — the same forgiving contract `parseDateRange` follows.
 */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** `?type=` → a report type. Defaults to the feedback tab. */
export function parseReportType(raw: string | string[] | undefined): FeedbackReportType {
  const parsed = reportTypeParam.safeParse(firstValue(raw));
  return parsed.success ? parsed.data : "feedback";
}

/** `?status=` → a status filter. Defaults to `open`: triage starts at the backlog. */
export function parseStatusFilter(
  raw: string | string[] | undefined
): FeedbackReportStatus | "all" {
  const parsed = statusParam.safeParse(firstValue(raw));
  return parsed.success ? parsed.data : "open";
}

/** `?reason=` → a reason filter, or undefined for "any reason". */
export function parseReasonFilter(raw: string | string[] | undefined): string | undefined {
  const parsed = reasonParam.safeParse(firstValue(raw));
  return parsed.success ? parsed.data : undefined;
}

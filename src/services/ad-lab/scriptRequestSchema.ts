import { z } from "zod";
import { AD_LAB_CONTENT_PURPOSES, ALL_OBJECTIVES, isObjectiveAllowedFor, getPurposeOptions } from "./contentPurpose";

export const scriptRequestSchema = z.object({
  brand: z.object({
    id: z.string(),
    name: z.string().trim().min(1).max(160),
    product: z.string().max(2_000),
    audience: z.string().max(2_000),
    promise: z.string().max(4_000),
    createdAt: z.string(),
  }),
  input: z.object({
    mainMessage: z.string().max(4_000),
    detailedContent: z.string().max(20_000),
    presentationDirection: z.string().max(500),
    contentPurpose: z.enum(AD_LAB_CONTENT_PURPOSES).default("advertisement"),
    objective: z.enum(ALL_OBJECTIVES),
    duration: z.enum(["15", "30", "45", "60", "90", "120", "180", "300", "600"]),
    revisionComment: z.string().trim().max(4_000).optional(),
    currentDraft: z.object({
      title: z.string().max(1_000),
      mainHook: z.string().max(4_000),
      scriptPlan: z.string().max(30_000),
    }).optional(),
  }).superRefine((data, ctx) => {
    if (!isObjectiveAllowedFor(data.contentPurpose, data.objective)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Objective "${data.objective}" is not valid for content purpose "${data.contentPurpose}"`,
        path: ["objective"],
      });
    }
    const allowedDurations = getPurposeOptions(data.contentPurpose).durations.map((d) => d.value);
    if (!allowedDurations.includes(data.duration)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duration "${data.duration}" is not valid for content purpose "${data.contentPurpose}"`,
        path: ["duration"],
      });
    }
  }),
});

export type ScriptRequestInput = z.input<typeof scriptRequestSchema>;
export type ScriptRequestOutput = z.output<typeof scriptRequestSchema>;

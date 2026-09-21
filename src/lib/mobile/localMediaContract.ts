import { z } from "zod";
import {
  ACCEPTED_MIME_TYPES,
  MAX_CLIP_DURATION_SECONDS,
  MAX_IMAGE_SIZE_BYTES,
  MAX_UPLOAD_COUNT,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
} from "@/domain/enums/AssetType";

/** Metadata that the server may retain. It never contains source media bytes. */
export const localMediaDescriptorSchema = z.object({
  localId: z.string().min(1).max(160),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(ACCEPTED_MIME_TYPES),
  fileSizeBytes: z.number().int().positive(),
  durationSeconds: z.number().positive().nullable(),
});

/** A small derivative sent for Gemini and stored as a montage proxy. */
export const localAnalysisFrameSchema = z.object({
  localId: z.string().min(1).max(160),
  assetIndex: z.number().int().nonnegative(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataBase64: z.string().min(1).max(1_500_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});

export const localMediaSubmissionSchema = z.object({
  mode: z.literal("local-first"),
  materials: z.array(localMediaDescriptorSchema).min(1).max(MAX_UPLOAD_COUNT),
  analysisFrames: z.array(localAnalysisFrameSchema).min(1).max(30),
}).superRefine((value, ctx) => {
  const ids = new Set(value.materials.map((material) => material.localId));
  if (ids.size !== value.materials.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["materials"], message: "Duplicate local media id" });
  }
  if (value.materials.reduce((sum, item) => sum + item.fileSizeBytes, 0) > MAX_UPLOAD_SIZE_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["materials"], message: "Source media exceeds the request size limit" });
  }
  for (const [index, item] of value.materials.entries()) {
    const video = item.mimeType.startsWith("video/");
    if (item.fileSizeBytes > (video ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["materials", index], message: "Source media exceeds the file size limit" });
    }
    if (video && item.durationSeconds != null && item.durationSeconds > MAX_CLIP_DURATION_SECONDS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["materials", index], message: "Source video exceeds the duration limit" });
    }
  }
  for (const frame of value.analysisFrames) {
    if (!ids.has(frame.localId) || value.materials[frame.assetIndex]?.localId !== frame.localId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["analysisFrames"],
        message: `Analysis frame refers to unknown local media: ${frame.localId}`,
      });
    }
    if (frame.assetIndex >= value.materials.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["analysisFrames"],
        message: `Analysis frame index is outside the material list: ${frame.assetIndex}`,
      });
    }
  }
  for (const [index, material] of value.materials.entries()) {
    if (!value.analysisFrames.some((frame) => frame.assetIndex === index && frame.localId === material.localId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["analysisFrames"],
        message: `A derived analysis image is required for ${material.localId}`,
      });
    }
  }
});

export type LocalMediaDescriptor = z.infer<typeof localMediaDescriptorSchema>;
export type LocalAnalysisFrame = z.infer<typeof localAnalysisFrameSchema>;
export type LocalMediaSubmission = z.infer<typeof localMediaSubmissionSchema>;

/** Keep request bodies bounded even if a client bypasses the form. */
export const MAX_LOCAL_ANALYSIS_BYTES = 8 * 1024 * 1024;

export function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

export function totalAnalysisBytes(frames: LocalAnalysisFrame[]): number {
  return frames.reduce((total, frame) => total + decodedBase64Bytes(frame.dataBase64), 0);
}

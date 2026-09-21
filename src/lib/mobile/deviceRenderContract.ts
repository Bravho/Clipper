import { z } from "zod";

/** Versioned wire contract between the web app, its native shells, and the render API. */
export const DEVICE_RENDER_CONTRACT_VERSION = 1;

export const videoRatioSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);

export const deviceRenderSourceSchema = z.object({
  assetId: z.string().min(1),
  /** Remote provider output, or a device-private source selected by the user. */
  url: z.string().url().optional(),
  localId: z.string().min(1).optional(),
  mimeType: z.string().min(1),
  durationSeconds: z.number().positive().nullable(),
}).refine((source) => Boolean(source.url) !== Boolean(source.localId), {
  message: "A source must have exactly one of url or localId",
});

export const deviceRenderCaptionSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  text: z.string().min(1),
  language: z.enum(["th", "en", "zh"]),
}).refine((caption) => caption.endSeconds > caption.startSeconds, {
  message: "Caption end must follow its start",
});

export const deviceRenderSceneSchema = z.object({
  sourceAssetId: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  cropX: z.number().min(0).max(1).default(0.5),
  cropY: z.number().min(0).max(1).default(0.5),
  motion: z.enum(["still", "zoom-in", "zoom-out", "pan-left", "pan-right"]).default("still"),
});

export const deviceRenderManifestSchema = z.object({
  version: z.literal(DEVICE_RENDER_CONTRACT_VERSION),
  attemptId: z.string().min(1),
  jobId: z.string().min(1),
  requestId: z.string().min(1),
  ratio: videoRatioSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().min(15).max(60),
  sources: z.array(deviceRenderSourceSchema).min(1),
  scenes: z.array(deviceRenderSceneSchema),
  masterUrl: z.string().url().nullable(),
  voiceUrl: z.string().url().nullable(),
  musicUrl: z.string().url().nullable(),
  captions: z.array(deviceRenderCaptionSchema),
  templateId: z.string().min(1),
  output: z.object({
    mimeType: z.literal("video/mp4"),
    videoCodec: z.literal("h264"),
    audioCodec: z.literal("aac"),
    maxBytes: z.number().int().positive(),
  }),
});

export type DeviceRenderManifest = z.infer<typeof deviceRenderManifestSchema>;

export const DEVICE_RENDER_DIMENSIONS: Record<z.infer<typeof videoRatioSchema>, {
  width: number; height: number;
}> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export function validateDeviceRenderManifest(input: unknown): DeviceRenderManifest {
  const manifest = deviceRenderManifestSchema.parse(input);
  const expected = DEVICE_RENDER_DIMENSIONS[manifest.ratio];
  if (manifest.width !== expected.width || manifest.height !== expected.height) {
    throw new Error(`Invalid dimensions for ${manifest.ratio}`);
  }
  const ids = new Set(manifest.sources.map((source) => source.assetId));
  if (manifest.scenes.some((scene) => !ids.has(scene.sourceAssetId))) {
    throw new Error("A scene refers to a source that is absent from the manifest");
  }
  if (!manifest.masterUrl && manifest.scenes.length === 0) {
    throw new Error("A render requires a master video or at least one scene");
  }
  return manifest;
}

import { z } from "zod";

/** Versioned wire contract between the web app, its native shells, and the render API. */
export const DEVICE_RENDER_CONTRACT_VERSION = 3;

export const videoRatioSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);

export const deviceRenderSourceSchema = z.object({
  assetId: z.string().min(1),
  kind: z.enum(["image", "clip"]),
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
  /** Transition into this approved scene; assets remain in their approved order. */
  transitionIn: z.enum(["cut", "fade", "slide", "zoom"]).default("fade"),
  assets: z.array(z.object({
    sourceAssetId: z.string().min(1),
    durationSeconds: z.number().positive(),
    motion: z.enum(["ken_burns_in", "ken_burns_out", "pan_left", "pan_right", "static"]),
    trimStartSeconds: z.number().nonnegative().optional(),
    trimEndSeconds: z.number().positive().optional(),
    focusX: z.number().min(0).max(1).default(0.5),
    focusY: z.number().min(0).max(1).default(0.5),
  })).min(1),
});

export const deviceRenderManifestSchema = z.object({
  version: z.literal(DEVICE_RENDER_CONTRACT_VERSION),
  attemptId: z.string().min(1),
  jobId: z.string().min(1),
  requestId: z.string().min(1),
  /** Montage is an intermediate. Only final may be delivered or published. */
  stage: z.enum(["montage", "final"]),
  ratio: videoRatioSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().min(15).max(60),
  sources: z.array(deviceRenderSourceSchema).min(1),
  scenes: z.array(deviceRenderSceneSchema),
  masterUrl: z.string().url().nullable(),
  voiceUrl: z.string().url().nullable(),
  musicUrl: z.string().url().nullable(),
  audio: z.object({
    /** The existing montage always mutes material clips. */
    sourceClipAudio: z.literal(false),
    /** True when the requester selected a background track for this export. */
    musicSelected: z.boolean(),
    voiceLeadInSeconds: z.literal(0.6),
    musicBedVolume: z.literal(0.3),
    musicDuckRatio: z.literal(2.5),
  }),
  captions: z.array(deviceRenderCaptionSchema),
  templateId: z.string().min(1),
  output: z.object({
    mimeType: z.literal("video/mp4"),
    videoCodec: z.literal("h264"),
    /** The intermediate montage has no audio track; final has AAC. */
    audioCodec: z.literal("aac").nullable(),
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
  const sources = new Map(manifest.sources.map((source) => [source.assetId, source]));
  if (sources.size !== manifest.sources.length) {
    throw new Error("Duplicate source asset id");
  }
  for (const source of manifest.sources) {
    if ((source.kind === "clip") !== source.mimeType.startsWith("video/")) {
      throw new Error("Source kind does not match its media type");
    }
  }
  for (const scene of manifest.scenes) {
    for (const shot of scene.assets) {
      const source = sources.get(shot.sourceAssetId);
      if (!source) throw new Error("A scene refers to a source that is absent from the manifest");
      if (source.kind === "clip") {
        if (shot.motion !== "static") throw new Error("Source clips must play without still-image motion");
        if (shot.trimEndSeconds != null && shot.trimEndSeconds <= (shot.trimStartSeconds ?? 0)) {
          throw new Error("Invalid clip trim window");
        }
        if (source.durationSeconds != null && shot.trimEndSeconds != null &&
            shot.trimEndSeconds > source.durationSeconds + 0.05) {
          throw new Error("Clip trim exceeds source duration");
        }
      } else if (shot.trimStartSeconds != null || shot.trimEndSeconds != null) {
        throw new Error("Still images cannot have a clip trim window");
      }
    }
  }
  if (manifest.stage === "montage") {
    if (manifest.scenes.length === 0 || manifest.masterUrl || manifest.voiceUrl ||
        manifest.musicUrl || manifest.output.audioCodec !== null) {
      throw new Error("A montage must contain scenes and remain a silent intermediate");
    }
  } else {
    if (!manifest.masterUrl || !manifest.voiceUrl || manifest.output.audioCodec !== "aac") {
      throw new Error("A final export requires its montage, approved voice, and AAC audio");
    }
    if (manifest.audio.musicSelected && !manifest.musicUrl) {
      throw new Error("Selected background music is missing from the final export");
    }
  }
  return manifest;
}

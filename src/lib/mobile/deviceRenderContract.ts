import { z } from "zod";
import {
  CAPTION_LANGUAGE_ORDER,
  DEVICE_MIN_CLIP_PLAYBACK_RATE,
  DEVICE_SCENE_CROSSFADE_SECONDS,
  DEVICE_TRANSITION_SECONDS,
} from "@/lib/mobile/deviceRenderCaptions";
import {
  DEVICE_MUSIC_BED_VOLUME,
  DEVICE_MUSIC_DUCK_ATTACK_MS,
  DEVICE_MUSIC_DUCK_RATIO,
  DEVICE_MUSIC_DUCK_RELEASE_MS,
  DEVICE_MUSIC_DUCK_THRESHOLD,
  DEVICE_MUSIC_LEAD_IN_SECONDS,
  DEVICE_MIX_LIMIT,
  DEVICE_MIX_SAMPLE_RATE,
  DEVICE_VOICE_MAX_GAIN_DB,
  DEVICE_VOICE_TARGET_LUFS,
  DEVICE_VOICE_TRUE_PEAK_DB,
} from "@/lib/mobile/deviceRenderAudio";

/**
 * Versioned wire contract between the web app, its native shells, and the
 * render API.
 *
 * v4 is the first version that can express a COMPLETE export rather than a
 * silent montage: still-image motion with subject focus, clip trims and
 * playback-rate fill, within-scene and between-scene transitions, the approved
 * voice with its full mix parameters, timed multilingual captions, the chosen
 * template and palette, the required output ratio including Travy, and the
 * cover still. `docs/device-render-parity.md` derives every value here from the
 * Remotion/FFmpeg pipeline it has to match.
 *
 * A manifest describes ONE render attempt: one stage, one ratio. The server
 * builds it from approved job data only (`deviceRenderManifestBuilder`), signs
 * short-lived object-scoped URLs into it, and never puts a provider key or a
 * Spaces credential in it.
 */
export const DEVICE_RENDER_CONTRACT_VERSION = 4;

/**
 * Contract versions a server build still accepts on a completion.
 *
 * An installed app is not upgraded by a server deploy, so a device can finish
 * an attempt it claimed with an older manifest. Accepting the previous version
 * on completion — while only ever ISSUING the current one — is what keeps a
 * mid-deploy render from being thrown away.
 */
export const DEVICE_RENDER_ACCEPTED_VERSIONS = [3, 4] as const;

export const videoRatioSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);
export type DeviceRenderRatio = z.infer<typeof videoRatioSchema>;

export const captionLanguageSchema = z.enum(["th", "en", "zh"]);

/**
 * The three renders the server pipeline actually performs, named so a device
 * can do exactly one of them and the result can be checked against what that
 * stage is allowed to contain.
 *
 *   montage — the approved photos and clips become one SILENT intermediate at
 *             the target ratio. Material audio is discarded. This is what
 *             `montageService` + the crossfade concat produce.
 *   master  — the montage plus the approved voice and the selected music,
 *             normalised, delayed by the lead-in, looped and ducked. No
 *             captions, no graphics. This is `_composeMasterForRatio`.
 *   final   — the master with the chosen template and the timed captions burned
 *             in, plus a cover still taken from its own frames. The master's
 *             audio is carried through untouched. This is
 *             `_renderCaptionedRatio`.
 *
 * Only `final` may be delivered or published.
 */
export const deviceRenderStageSchema = z.enum(["montage", "master", "final"]);
export type DeviceRenderStage = z.infer<typeof deviceRenderStageSchema>;

export const motionPresetSchema = z.enum([
  "ken_burns_in",
  "ken_burns_out",
  "pan_left",
  "pan_right",
  "static",
]);

export const montageTransitionSchema = z.enum(["cut", "fade", "slide", "zoom"]);

/**
 * One piece of source material.
 *
 * Exactly one of `url` (a short-lived, object-scoped URL for media already in
 * storage) or `localId` (a handle into the device's own private storage). The
 * local-first submission path keeps originals on the phone, so the manifest
 * must be able to name them without the server ever holding their bytes.
 */
export const deviceRenderSourceSchema = z.object({
  assetId: z.string().min(1),
  kind: z.enum(["image", "clip"]),
  url: z.string().url().optional(),
  localId: z.string().min(1).optional(),
  mimeType: z.string().min(1),
  durationSeconds: z.number().positive().nullable(),
}).refine((source) => Boolean(source.url) !== Boolean(source.localId), {
  message: "A source must have exactly one of url or localId",
});

/**
 * One caption cue. All three language texts travel together — the renderer
 * draws the subset named by `captionLanguages`, exactly as `CaptionOverlay`
 * picks fields out of a `TimedSegment`.
 *
 * Times are ALREADY shifted by the music lead-in. The server does that shift
 * once (`_buildOverlayInputs`) so a device never has to know whether music was
 * selected in order to place a caption.
 */
export const deviceRenderCaptionSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  textThai: z.string().default(""),
  textEnglish: z.string().default(""),
  textChinese: z.string().default(""),
}).refine((caption) => caption.endSeconds > caption.startSeconds, {
  message: "Caption end must follow its start",
}).refine(
  (caption) => Boolean(caption.textThai || caption.textEnglish || caption.textChinese),
  { message: "A caption cue must carry text in at least one language" }
);

export const deviceRenderShotSchema = z.object({
  sourceAssetId: z.string().min(1),
  /** The slot this shot occupies in the scene, before any dissolve overlap. */
  durationSeconds: z.number().positive(),
  motion: motionPresetSchema,
  trimStartSeconds: z.number().nonnegative().optional(),
  trimEndSeconds: z.number().positive().optional(),
  focusX: z.number().min(0).max(1).default(0.5),
  focusY: z.number().min(0).max(1).default(0.5),
  /**
   * How much of the picture shows when its shape is not the video's: 0 = the
   * whole photo or clip (bars fill the rest), 1 = fill the frame and crop the
   * edges around the focus point. See `shotFraming.ts`. Defaults to 1, which is
   * what every renderer did before this existed, so an older plan is unchanged.
   */
  frameZoom: z.number().min(0).max(1).default(1),
  /**
   * Playback rate for a clip whose slot outruns its footage. 1 for stills and
   * for clips with footage to spare; never below
   * {@link DEVICE_MIN_CLIP_PLAYBACK_RATE}.
   */
  playbackRate: z.number().min(DEVICE_MIN_CLIP_PLAYBACK_RATE).max(1).default(1),
});

export const deviceRenderSceneSchema = z.object({
  sceneNumber: z.number().int().nonnegative(),
  /** Transition into this approved scene; assets remain in their approved order. */
  transitionIn: montageTransitionSchema.default("fade"),
  /** Within-scene cross-dissolve length between consecutive shots. */
  shotTransitionSeconds: z.number().nonnegative().default(DEVICE_TRANSITION_SECONDS),
  assets: z.array(deviceRenderShotSchema).min(1),
});

export const deviceRenderAudioSchema = z.object({
  /** The existing montage always mutes material clips. */
  sourceClipAudio: z.literal(false),
  /** True when the requester selected a background track for this export. */
  musicSelected: z.boolean(),
  sampleRate: z.literal(DEVICE_MIX_SAMPLE_RATE),
  /** 0.6 with music, 0 without — the FFmpeg path drops the lead-in too. */
  voiceLeadInSeconds: z.number().nonnegative(),
  musicBedVolume: z.literal(DEVICE_MUSIC_BED_VOLUME),
  musicDuckRatio: z.literal(DEVICE_MUSIC_DUCK_RATIO),
  musicDuckThreshold: z.literal(DEVICE_MUSIC_DUCK_THRESHOLD),
  musicDuckAttackMs: z.literal(DEVICE_MUSIC_DUCK_ATTACK_MS),
  musicDuckReleaseMs: z.literal(DEVICE_MUSIC_DUCK_RELEASE_MS),
  voiceTargetLufs: z.literal(DEVICE_VOICE_TARGET_LUFS),
  voiceTruePeakDb: z.literal(DEVICE_VOICE_TRUE_PEAK_DB),
  voiceMaxGainDb: z.literal(DEVICE_VOICE_MAX_GAIN_DB),
  mixLimit: z.literal(DEVICE_MIX_LIMIT),
  /** Measured length of the approved voice track. */
  voiceDurationSeconds: z.number().positive().nullable(),
});

export const devicePaletteSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  neutral: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const deviceTemplateSchema = z.object({
  id: z.string().min(1),
  frame: z.enum(["full_bleed", "corner_bracket", "polaroid", "rounded_inset"]),
  canvas: z.enum(["none", "black", "palette_light", "palette_dark"]),
  decor: z.array(z.string().min(1)),
  palette: devicePaletteSchema,
});

/**
 * Where the rendered bytes go.
 *
 * The device uploads straight to object storage with presigned part URLs — it
 * never streams a finished export back through the web app. The key is minted
 * by the server, so a device cannot choose where its output lands. This is null
 * in the manifest handed out at claim time: the part count depends on the size
 * of a file that does not exist yet, so the device asks for part URLs once the
 * render is done.
 */
export const deviceRenderUploadSchema = z.object({
  storageKey: z.string().min(1),
  uploadId: z.string().min(1),
  partSizeBytes: z.number().int().positive(),
  parts: z.array(z.object({
    partNumber: z.number().int().positive(),
    url: z.string().url(),
  })).min(1),
  /** Where the cover still goes, for a stage that produces one. */
  coverStorageKey: z.string().min(1).nullable(),
  coverUrl: z.string().url().nullable(),
  expiresAt: z.string().datetime(),
});

export const deviceRenderOutputSchema = z.object({
  mimeType: z.literal("video/mp4"),
  videoCodec: z.literal("h264"),
  /** The silent montage has no audio track; master and final carry AAC. */
  audioCodec: z.literal("aac").nullable(),
  maxBytes: z.number().int().positive(),
  /** A finished export must also yield a JPEG poster taken from its own frames. */
  coverRequired: z.boolean().default(false),
  /** Where in the finished video to take the cover from. */
  coverAtSeconds: z.number().nonnegative().default(1),
});

export const deviceRenderManifestSchema = z.object({
  version: z.literal(DEVICE_RENDER_CONTRACT_VERSION),
  attemptId: z.string().min(1),
  taskId: z.string().min(1),
  jobId: z.string().min(1),
  requestId: z.string().min(1),
  /** The queued render step this attempt satisfies, e.g. overlay_composition. */
  step: z.string().min(1),
  stage: deviceRenderStageSchema,
  /** True when this export is the Travy clip: captions are forced to EN+ZH. */
  travy: z.boolean().default(false),
  ratio: videoRatioSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().min(15).max(60),
  /** Between-scene cross-dissolve, matching the server's xfade. */
  sceneTransitionSeconds: z.number().nonnegative().default(DEVICE_SCENE_CROSSFADE_SECONDS),
  sources: z.array(deviceRenderSourceSchema),
  scenes: z.array(deviceRenderSceneSchema),
  /**
   * The input this stage builds on: the silent montage for `master`, the merged
   * master for `final`. Null for `montage`, which builds from sources.
   */
  masterUrl: z.string().url().nullable(),
  voiceUrl: z.string().url().nullable(),
  musicUrl: z.string().url().nullable(),
  audio: deviceRenderAudioSchema,
  captions: z.array(deviceRenderCaptionSchema),
  captionLanguages: z.array(captionLanguageSchema).max(3),
  template: deviceTemplateSchema,
  output: deviceRenderOutputSchema,
  upload: deviceRenderUploadSchema.nullable(),
  /** Lease expiry. A device past this must stop and release rather than upload. */
  leaseExpiresAt: z.string().datetime(),
  /**
   * Render this master or final from the approved originals in ONE encode —
   * picture, mix and (for a final) template and captions together — instead of
   * from the previous stage's export. Only sent to plugin version 6+
   * (`SOURCE_EDIT_PLUGIN_VERSION`); older builds never see it and keep the
   * download path. Always false for a montage, which builds from sources anyway.
   */
  buildFromSources: z.boolean().default(false),
});

export type DeviceRenderManifest = z.infer<typeof deviceRenderManifestSchema>;
export type DeviceRenderScene = z.infer<typeof deviceRenderSceneSchema>;
export type DeviceRenderShot = z.infer<typeof deviceRenderShotSchema>;
export type DeviceRenderSource = z.infer<typeof deviceRenderSourceSchema>;
export type DeviceRenderCaption = z.infer<typeof deviceRenderCaptionSchema>;
export type DeviceRenderTemplate = z.infer<typeof deviceTemplateSchema>;
export type DeviceRenderUpload = z.infer<typeof deviceRenderUploadSchema>;

export const DEVICE_RENDER_DIMENSIONS: Record<DeviceRenderRatio, {
  width: number; height: number;
}> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

/** Travy always ships English + Chinese, whatever the requester chose. */
export const TRAVY_CAPTION_LANGUAGES = ["en", "zh"] as const;

/**
 * Total on-screen length of a manifest's picture, in seconds.
 *
 * Shots are contiguous within a scene — a dissolve borrows from the adjacent
 * slot rather than extending the timeline — so the picture is the sum of every
 * slot MINUS the between-scene crossfade overlaps, which is exactly what
 * `crossfadeConcatLocal` produces before its tail padding.
 */
export function manifestPictureSeconds(manifest: DeviceRenderManifest): number {
  const scenesTotal = manifest.scenes.reduce(
    (total, scene) => total + scene.assets.reduce((sum, shot) => sum + shot.durationSeconds, 0),
    0
  );
  const joins = Math.max(0, manifest.scenes.length - 1);
  return Math.max(0, scenesTotal - joins * manifest.sceneTransitionSeconds);
}

function assertSilentIntermediate(manifest: DeviceRenderManifest): void {
  if (manifest.scenes.length === 0) {
    throw new Error("A montage must contain scenes");
  }
  if (manifest.sources.length === 0) {
    throw new Error("A montage must carry its approved source material");
  }
  if (manifest.masterUrl || manifest.voiceUrl || manifest.musicUrl) {
    throw new Error("A montage builds from sources only");
  }
  if (manifest.output.audioCodec !== null) {
    throw new Error("A montage must remain a silent intermediate");
  }
  if (manifest.captions.length > 0 || manifest.captionLanguages.length > 0) {
    throw new Error("Captions are burned in at the final stage, not the montage");
  }
  if (manifest.output.coverRequired) {
    throw new Error("Only a finished export produces a cover");
  }
}

/** A master or final composed from the originals needs everything a montage does. */
function assertBuildsFromSources(manifest: DeviceRenderManifest): void {
  if (manifest.scenes.length === 0) {
    throw new Error("A render from sources must contain scenes");
  }
  if (manifest.sources.length === 0) {
    throw new Error("A render from sources must carry its approved source material");
  }
  if (!manifest.voiceUrl) {
    throw new Error("A render from sources mixes the approved voice itself");
  }
  if (manifest.audio.musicSelected && !manifest.musicUrl) {
    throw new Error("Selected background music is missing from the render");
  }
  if (manifest.masterUrl) {
    throw new Error("A render from sources does not build on a downloaded intermediate");
  }
}

function assertMergedMaster(manifest: DeviceRenderManifest): void {
  if (manifest.buildFromSources) assertBuildsFromSources(manifest);
  if (!manifest.voiceUrl) {
    throw new Error("A merged master requires the approved voice");
  }
  if (manifest.output.audioCodec !== "aac") {
    throw new Error("A merged master must carry AAC audio");
  }
  if (!manifest.masterUrl && manifest.scenes.length === 0) {
    throw new Error("A merged master needs either its montage or the scenes to build one");
  }
  if (manifest.audio.musicSelected && !manifest.musicUrl) {
    throw new Error("Selected background music is missing from the merged master");
  }
  if (!manifest.audio.musicSelected && manifest.audio.voiceLeadInSeconds !== 0) {
    throw new Error("Without music there is no music-only lead-in");
  }
  if (
    manifest.audio.musicSelected &&
    manifest.audio.voiceLeadInSeconds !== DEVICE_MUSIC_LEAD_IN_SECONDS
  ) {
    throw new Error("The music lead-in must match the server mix");
  }
  if (manifest.captions.length > 0 || manifest.captionLanguages.length > 0) {
    throw new Error("Captions are burned in at the final stage, not the master");
  }
  if (manifest.output.coverRequired) {
    throw new Error("Only a finished export produces a cover");
  }
}

function assertFinalExport(manifest: DeviceRenderManifest): void {
  if (manifest.buildFromSources) {
    // Composed from the originals: the final mixes the voice and music itself,
    // with the same lead-in the master used, so its captions line up.
    assertBuildsFromSources(manifest);
    if (!manifest.audio.musicSelected && manifest.audio.voiceLeadInSeconds !== 0) {
      throw new Error("Without music there is no music-only lead-in");
    }
    if (
      manifest.audio.musicSelected &&
      manifest.audio.voiceLeadInSeconds !== DEVICE_MUSIC_LEAD_IN_SECONDS
    ) {
      throw new Error("The music lead-in must match the server mix");
    }
  } else {
    // The master already carries the mixed voice and ducked music; the final
    // pass copies that audio through untouched, exactly as `overlayOnMaster`
    // does with `-c:a copy`. Re-sending the voice here would invite a second mix.
    if (!manifest.masterUrl) {
      throw new Error("A final export is rendered from its approved merged master");
    }
    if (manifest.voiceUrl || manifest.musicUrl) {
      throw new Error("A final export carries the master's audio, not a second mix");
    }
  }
  if (manifest.output.audioCodec !== "aac") {
    throw new Error("A final export must keep the master's AAC audio");
  }
  if (manifest.captionLanguages.length === 0) {
    throw new Error("A final export must name the caption languages to burn in");
  }
  if (!manifest.output.coverRequired) {
    throw new Error("A final export must produce its own cover still");
  }
}

/**
 * Validate a manifest and every cross-field rule the renderers rely on.
 *
 * Throws with a specific message rather than returning a flag: a manifest that
 * does not hold together is a server bug, and a device that renders it anyway
 * produces a video someone has to notice by watching it.
 */
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
        if (shot.motion !== "static") {
          throw new Error("Source clips must play without still-image motion");
        }
        if (shot.trimEndSeconds != null && shot.trimEndSeconds <= (shot.trimStartSeconds ?? 0)) {
          throw new Error("Invalid clip trim window");
        }
        if (
          source.durationSeconds != null &&
          shot.trimEndSeconds != null &&
          shot.trimEndSeconds > source.durationSeconds + 0.05
        ) {
          throw new Error("Clip trim exceeds source duration");
        }
      } else {
        if (shot.trimStartSeconds != null || shot.trimEndSeconds != null) {
          throw new Error("Still images cannot have a clip trim window");
        }
        if (shot.playbackRate !== 1) {
          throw new Error("Still images play at the timeline rate");
        }
      }
    }
  }

  // Captions must be ordered and non-overlapping: the overlay draws the FIRST
  // cue that contains the current time, so an overlap silently hides a line.
  let previousEnd = -1;
  for (const caption of manifest.captions) {
    if (caption.startSeconds < previousEnd - 0.001) {
      throw new Error("Caption cues must not overlap");
    }
    previousEnd = caption.endSeconds;
  }

  const languages = new Set(manifest.captionLanguages);
  if (languages.size !== manifest.captionLanguages.length) {
    throw new Error("Duplicate caption language");
  }
  for (const language of manifest.captionLanguages) {
    if (!CAPTION_LANGUAGE_ORDER.includes(language)) {
      throw new Error(`Unsupported caption language: ${language}`);
    }
  }
  if (manifest.travy) {
    if (manifest.stage !== "final") {
      throw new Error("Only a finished export can be the Travy clip");
    }
    const travy = new Set<string>(TRAVY_CAPTION_LANGUAGES);
    if (languages.size !== travy.size || [...languages].some((l) => !travy.has(l))) {
      throw new Error("The Travy export must carry English and Chinese captions");
    }
  }

  if (manifest.stage === "montage" && manifest.buildFromSources) {
    throw new Error("A montage always builds from sources; the flag is for master and final");
  }
  if (manifest.stage === "montage") assertSilentIntermediate(manifest);
  else if (manifest.stage === "master") assertMergedMaster(manifest);
  else assertFinalExport(manifest);

  if (manifest.upload) {
    if (manifest.output.coverRequired && !manifest.upload.coverStorageKey) {
      throw new Error("A stage that produces a cover needs somewhere to put it");
    }
    const expiry = Date.parse(manifest.upload.expiresAt);
    const lease = Date.parse(manifest.leaseExpiresAt);
    if (Number.isFinite(expiry) && Number.isFinite(lease) && expiry < lease) {
      throw new Error("Upload authorisation expires before the render lease");
    }
  }

  return manifest;
}

/** Narrow a completion's reported version to one this build still honours. */
export function isAcceptedManifestVersion(version: unknown): boolean {
  return (
    typeof version === "number" &&
    (DEVICE_RENDER_ACCEPTED_VERSIONS as readonly number[]).includes(version)
  );
}

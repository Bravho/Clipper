import { z } from "zod";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Strict Zod schema for optional HeyGen video-generation settings.
 * Unknown keys are rejected (strict mode) so the service can safely
 * surface them as invalid_key errors with a Thai message.
 */
export const avatarVideoSettingsSchema = z
  .object({
    /** Override output resolution. 1080p is the app default (already sent); 720p overrides it. */
    resolution: z.enum(["1080p", "720p"]).optional(),
    /** How the avatar is fitted in the frame. Omit = HeyGen auto. */
    fit: z.enum(["cover", "contain"]).optional(),
    /** Solid-colour background (#RRGGBB). */
    background: z
      .object({
        type: z.literal("color"),
        value: z.string().regex(HEX_COLOR_RE, "background.value ต้องเป็นสีในรูปแบบ #RRGGBB"),
      })
      .optional(),
    /** Remove the background (avatar must have been trained with matting). */
    remove_background: z.boolean().optional(),
    /** Natural-language motion instruction (1–500 chars). Applicable only to certain avatar types. */
    motion_prompt: z.string().min(1).max(500).optional(),
    /** Avatar expressiveness level. Only photo_avatar + avatar_iv. */
    expressiveness: z.enum(["low", "medium", "high"]).optional(),
    /**
     * HeyGen TTS voice settings. Only applicable when the video is created with
     * a voice_id (TTS mode). Ignored in audio-asset mode.
     */
    voice_settings: z
      .object({
        speed: z.number().min(0.5).max(1.5).optional(),
        pitch: z.number().int().min(-50).max(50).optional(),
        volume: z.number().min(0).max(1).optional(),
      })
      .optional(),
    /** Burn-in SRT captions. */
    caption: z
      .object({
        file_format: z.literal("srt"),
        style: z.literal("default"),
      })
      .optional(),
    /** Title shown in the HeyGen dashboard (1–100 chars). */
    title: z.string().min(1).max(100).optional(),
  })
  .strict(); // unknown keys → ZodError

export type AvatarVideoSettings = z.infer<typeof avatarVideoSettingsSchema>;

// ---------------------------------------------------------------------------

/**
 * Drop settings fields that HeyGen does not accept for the given
 * engine / avatarType / mode combination.  Also strips fields whose
 * value equals the HeyGen default (so they don't appear in the body).
 * Returns a shallow copy — never mutates the input.
 */
export function applicableSettings(
  settings: AvatarVideoSettings,
  ctx: { engine: "avatar_v" | "avatar_iv"; avatarType: string; mode: "audio" | "tts" }
): AvatarVideoSettings {
  const r: AvatarVideoSettings = { ...settings };

  // motion_prompt: allowed for photo_avatar (any engine) or
  // digital_twin/studio_avatar + avatar_v.  Drop for video avatars + avatar_iv.
  const isVideoAvatar = ctx.avatarType === "digital_twin" || ctx.avatarType === "studio_avatar";
  const allowMotion =
    ctx.avatarType === "photo_avatar" || (isVideoAvatar && ctx.engine === "avatar_v");
  if (!allowMotion) delete r.motion_prompt;

  // expressiveness: only photo_avatar + avatar_iv
  if (!(ctx.avatarType === "photo_avatar" && ctx.engine === "avatar_iv")) delete r.expressiveness;

  // voice_settings: only TTS mode (voice_id path)
  if (ctx.mode !== "tts") delete r.voice_settings;

  // Omit voice_settings sub-fields that are already at their defaults
  // (speed 1.0, pitch 0, volume 1.0)
  if (r.voice_settings) {
    const vs: NonNullable<AvatarVideoSettings["voice_settings"]> = {};
    if (r.voice_settings.speed !== undefined && r.voice_settings.speed !== 1) vs.speed = r.voice_settings.speed;
    if (r.voice_settings.pitch !== undefined && r.voice_settings.pitch !== 0) vs.pitch = r.voice_settings.pitch;
    if (r.voice_settings.volume !== undefined && r.voice_settings.volume !== 1) vs.volume = r.voice_settings.volume;
    if (Object.keys(vs).length === 0) delete r.voice_settings;
    else r.voice_settings = vs;
  }

  // resolution 1080p is already hardcoded in the base request params — drop it to avoid
  // redundancy (720p is the only override that matters).
  if (r.resolution === "1080p") delete r.resolution;

  return r;
}

// ---------------------------------------------------------------------------

/**
 * Build a compact human-readable summary of non-default applied settings
 * for display in the CostConfirmDialog and VideoManagerSection.
 * Returns an empty string when the object carries no fields.
 */
export function settingsSummary(settings: AvatarVideoSettings): string {
  const parts: string[] = [];
  if (settings.resolution) parts.push(settings.resolution);
  if (settings.fit) parts.push(settings.fit);
  if (settings.background) parts.push(`BG ${settings.background.value}`);
  if (settings.remove_background) parts.push("ลบ BG");
  if (settings.motion_prompt) parts.push("motion");
  if (settings.expressiveness) parts.push(`expr:${settings.expressiveness}`);
  if (settings.voice_settings) {
    const vs = settings.voice_settings;
    if (vs.speed !== undefined) parts.push(`speed ${vs.speed}`);
    if (vs.pitch !== undefined) parts.push(`pitch ${vs.pitch}`);
    if (vs.volume !== undefined) parts.push(`vol ${vs.volume}`);
  }
  if (settings.caption) parts.push("captions");
  if (settings.title) parts.push(`title`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------

/** Look frame info used to decide the default fit. */
export interface LookFrame {
  width?: number;
  height?: number;
  orientation?: "portrait" | "landscape" | "square";
}

const RATIO_VALUES: Record<string, number> = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1, "4:5": 4 / 5, "5:4": 5 / 4 };

/**
 * True when the look's frame does not match the output ratio (so HeyGen's own
 * choice may be "contain" = letterbox). Unknown frame size counts as a mismatch
 * so the default is to fill the frame. "auto" never mismatches (keeps the source frame).
 */
export function frameMismatch(aspectRatio: string, look: LookFrame): boolean {
  const target = RATIO_VALUES[aspectRatio];
  if (target === undefined) return false; // "auto"
  let source: number | undefined;
  if (look.width && look.height) source = look.width / look.height;
  else if (look.orientation === "landscape") source = 16 / 9;
  else if (look.orientation === "portrait") source = 9 / 16;
  else if (look.orientation === "square") source = 1;
  if (source === undefined) return true;
  return Math.abs(target - source) / source > 0.03;
}

/**
 * Default fit: when the user didn't choose a fit and the look's frame doesn't
 * match the output ratio, use "cover" (fill the frame, crop the edges) instead
 * of letting HeyGen pick (it chose "contain" = letterbox for a landscape twin in 9:16).
 * An explicit fit always wins.
 * Docs: https://developers.heygen.com/reference/create-video - fit: "cover" | "contain"
 * (checked 2026-10-13).
 */
export function withDefaultFit(settings: AvatarVideoSettings, aspectRatio: string, look: LookFrame): AvatarVideoSettings {
  if (settings.fit !== undefined) return settings;
  if (!frameMismatch(aspectRatio, look)) return settings;
  return { ...settings, fit: "cover" };
}

import { DEFAULT_HEYGEN_ASPECT_RATIO, isHeyGenAspectRatio, type HeyGenAspectRatio } from "@/config/heygenAspectRatios";
/**
 * AdLabAvatarService — server-side orchestration for the optional AI Avatar step.
 *
 * Flow (Avatar V Digital Twin):
 *   1. generateVoice       — ElevenLabs TTS → upload MP3 to Spaces (private)
 *   2. getLooks            — list eligible HeyGen Digital Twin looks for the picker
 *   3. prepareVideoAssets  — fetch audio from Spaces, upload to HeyGen,
 *                            return audioAssetId + HMAC proof token (assetToken)
 *   4. createVideo         — verify assetToken, validate lookId eligibility,
 *                            submit Avatar V generation job with engine avatar_v
 *                            (no Spaces reads — uses asset IDs from step 3)
 *   5. getVideoStatus      — poll HeyGen; on completion stream-copy MP4 into Spaces
 *   6. signedMedia         — short-lived signed GET for any avatar asset key
 *
 * Legacy methods:
 *   beginImageUpload — kept in place but the image-upload route returns 410; not called by new UI
 *
 * IMPORTANT: This service never writes the workspace. All results are returned
 * to the route and the CLIENT stores them in draft.avatar (last-write-wins).
 *
 * Injected dependencies (constructor options) let tests replace every I/O call
 * without touching this file — no live network calls in tests.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { AdLabScriptDraft, AdLabAvatarVoice } from "@/domain/models/AdLab";
import {
  AD_LAB_AVATAR_VOICES,
  DEFAULT_AD_LAB_AVATAR_VOICE_ID,
  isSupportedAdLabAvatarVoiceId,
} from "@/config/elevenLabsVoices";
import {
  AD_LAB_VOICE_SPEEDS,
  AD_LAB_VOICE_TONES,
  DEFAULT_VOICE_SPEED_ID,
  DEFAULT_VOICE_TONE_ID,
  resolveSpeedId,
  resolveToneId,
  getSpeedValue,
  getToneVoiceSettings,
  type AdLabVoiceSpeedId,
  type AdLabVoiceToneId,
} from "@/config/adLabVoiceOptions";
import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, SPACES_BUCKET, spacesSendWithRetry, spacesSignedUrl } from "@/lib/spaces";
import { synthesizeSpeech } from "@/lib/ai/elevenLabsTtsService";
import { HeyGenClient, HeyGenApiError, HeyGenNotConfiguredError, type HeyGenLook, type HeyGenVideoEngine } from "@/lib/ai/heygenClient";
import { avatarVideoSettingsSchema, applicableSettings, withDefaultFit, type AvatarVideoSettings } from "@/config/heygenVideoOptions";
import { spacesUploadStream } from "@/lib/spacesStreamUpload";
import { isAdLabLocalUserId } from "@/lib/auth/adLabLocalCredentials";
import {
  ELEVENLABS_V3_MAX_CHARS,
  ELEVENLABS_V3_USD_PER_1K_CHARS,
  HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC,
  THAI_CHARS_PER_SECOND,
  avatarMaxSeconds,
  estimateAvatarVideoCostUsd,
  estimateSpeechSeconds,
  estimateVoiceCostUsd,
} from "./avatarCost";
import { avatarKeyPrefix, buildSpokenText, isOwnAvatarKey, scriptHash } from "./avatarScript";

// ---------------------------------------------------------------------------
// Error

export type AdLabAvatarErrorCode =
  | "not_found"
  | "not_approved"
  | "heygen_not_configured"
  | "elevenlabs_not_configured"
  | "too_long"
  | "invalid_voice"
  | "invalid_image"
  | "invalid_key"
  | "invalid_token"
  | "provider_error"
  | "rate_limited"
  | "local_account"
  | "look_not_found"
  | "look_not_eligible"
  | "tts_voice_missing"
  | "twin_type_invalid"
  | "twin_too_large"
  | "twin_duration_invalid"
  | "twin_consent_conflict";

export class AdLabAvatarError extends Error {
  constructor(
    readonly code: AdLabAvatarErrorCode,
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "AdLabAvatarError";
  }
}

// ---------------------------------------------------------------------------
// Dependency injection types

type LoadDraftFn = (ownerId: string, draftId: string) => Promise<AdLabScriptDraft | null>;
type SignUrlFn = (key: string, ttl?: number, opts?: { downloadFileName?: string }) => Promise<string>;

export interface AdLabAvatarServiceDeps {
  loadDraft: LoadDraftFn;
  synthesize?: typeof synthesizeSpeech;
  heygen?: () => HeyGenClient;
  s3?: S3Client;
  bucket?: string;
  signUrl?: SignUrlFn;
  uploadStream?: typeof spacesUploadStream;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  tokenSecret?: () => string;
  /** Whether the ElevenLabs key is present (default: AI_CONFIG.elevenLabs.apiKey). */
  elevenLabsConfigured?: () => boolean;
}

// ---------------------------------------------------------------------------
// Constants

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_:.-]{8,255}$/;
const ASSET_ID_RE = /^[A-Za-z0-9._-]{1,256}$/;
const LOOK_ID_RE = /^[A-Za-z0-9_:.-]{1,255}$/;
const AUDIO_MAX_BYTES = 50 * 1024 * 1024;  // 50 MB
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;  // 10 MB — kept for legacy beginImageUpload
/** Validate a client-supplied aspect ratio against the HeyGen allowlist (default 9:16). */
export function resolveAspectRatio(value: string | undefined): HeyGenAspectRatio {
  if (value === undefined || value === "") return DEFAULT_HEYGEN_ASPECT_RATIO;
  if (!isHeyGenAspectRatio(value)) {
    throw new AdLabAvatarError("invalid_key", `aspectRatio ${String(value).slice(0, 20)} \u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A`);
  }
  return value;
}

/** Maximum pages to paginate when listing looks. */
const LOOKS_MAX_PAGES = 5;

/**
 * Validate raw `settings` input from the route body.
 * Unknown keys → invalid_key.  Returns an empty object when settings is nil.
 */
function validateSettings(raw: unknown): AvatarVideoSettings {
  if (raw === undefined || raw === null) return {};
  const result = avatarVideoSettingsSchema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.errors[0]?.message ?? "invalid settings";
    throw new AdLabAvatarError("invalid_key", `การตั้งค่าวิดีโอไม่ถูกต้อง: ${msg}`);
  }
  return result.data;
}

/**
 * Pick the render engine for a look, server-side, from its supported_api_engines:
 * avatar_v when supported, else avatar_iv. Returns null when the look is not
 * ready (status other than completed) or supports neither engine.
 */
export function pickEngine(look: HeyGenLook): HeyGenVideoEngine | null {
  if (look.status && look.status !== "completed") return null;
  if (look.supportedApiEngines.includes("avatar_v")) return "avatar_v";
  if (look.supportedApiEngines.includes("avatar_iv")) return "avatar_iv";
  return null;
}

// ---------------------------------------------------------------------------

export class AdLabAvatarService {
  private readonly loadDraft: LoadDraftFn;
  private readonly _synthesize: typeof synthesizeSpeech;
  private readonly _heygenFactory: () => HeyGenClient;
  private readonly _s3: S3Client;
  private readonly _bucket: string;
  private readonly _signUrl: SignUrlFn;
  private readonly _uploadStream: typeof spacesUploadStream;
  private readonly _fetch: typeof fetch;
  private readonly _now: () => Date;
  private readonly _tokenSecret: () => string;
  private readonly _elevenLabsConfigured: () => boolean;

  constructor(deps: AdLabAvatarServiceDeps) {
    this.loadDraft = deps.loadDraft;
    this._synthesize = deps.synthesize ?? synthesizeSpeech;
    this._heygenFactory =
      deps.heygen ??
      (() => new HeyGenClient({ fetchImpl: this._fetch }));
    this._s3 = deps.s3 ?? spacesClient;
    this._bucket = deps.bucket ?? SPACES_BUCKET;
    this._signUrl = deps.signUrl ?? ((key, ttl = 3600, opts) => spacesSignedUrl(key, ttl, opts));
    this._elevenLabsConfigured = deps.elevenLabsConfigured ?? (() => Boolean(AI_CONFIG.elevenLabs.apiKey));
    this._uploadStream = deps.uploadStream ?? spacesUploadStream;
    this._fetch = deps.fetchImpl ?? fetch;
    this._now = deps.now ?? (() => new Date());
    this._tokenSecret =
      deps.tokenSecret ??
      (() => {
        const s = process.env.NEXTAUTH_SECRET;
        if (!s) throw new AdLabAvatarError("provider_error", "NEXTAUTH_SECRET is not configured");
        return s;
      });
  }

  // ── getConfig ──────────────────────────────────────────────────────────────

  getConfig() {
    const heygenConfigured = Boolean((process.env.HEYGEN_API_KEY ?? "").trim());
    const elevenLabsConfigured = this._elevenLabsConfigured();
    return {
      heygenConfigured,
      elevenLabsConfigured,
      maxSeconds: avatarMaxSeconds(),
      voices: AD_LAB_AVATAR_VOICES.map((v) => ({ id: v.id, label: v.label, gender: v.gender, previewUrl: v.previewUrl })),
      defaultVoiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID,
      speeds: AD_LAB_VOICE_SPEEDS.map((s) => ({ id: s.id, label: s.label, speed: s.speed })),
      defaultSpeedId: DEFAULT_VOICE_SPEED_ID,
      tones: AD_LAB_VOICE_TONES.map((t) => ({ id: t.id, label: t.label })),
      defaultToneId: DEFAULT_VOICE_TONE_ID,
      rates: {
        voiceUsdPer1kChars: ELEVENLABS_V3_USD_PER_1K_CHARS,
        avatarUsdPerSec: HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC,
      },
      thaiCharsPerSecond: THAI_CHARS_PER_SECOND,
    };
  }

  // ── getLooks ───────────────────────────────────────────────────────────────

  /**
   * List eligible HeyGen Digital Twin looks for the Avatar V picker.
   * Returns {configured:false, looks:[]} when HEYGEN_API_KEY is absent.
   * Eligible = avatar_type "digital_twin" + engine "avatar_v" supported + status "completed" (or absent).
   * Reads optional default look ID from process.env.RCLIPPER_AD_LAB_HEYGEN_LOOK_ID.
   */
  async getLooks(): Promise<{
    configured: boolean;
    looks: Array<{
      id: string;
      name: string;
      avatarType: string;
      groupId?: string;
      previewImageUrl?: string;
      previewVideoUrl?: string;
      status?: string;
      supportedApiEngines: string[];
      engine: HeyGenVideoEngine | null;
      selectable: boolean;
      defaultVoiceId?: string;
    }>;
    defaultLookId?: string;
  }> {
    if (!Boolean((process.env.HEYGEN_API_KEY ?? "").trim())) {
      return { configured: false, looks: [] };
    }

    let heygen: HeyGenClient;
    try {
      heygen = this._heygenFactory();
    } catch (err) {
      if (err instanceof HeyGenNotConfiguredError) {
        return { configured: false, looks: [] };
      }
      throw err;
    }

    const allLooks: HeyGenLook[] = [];
    let token: string | undefined;
    for (let page = 0; page < LOOKS_MAX_PAGES; page++) {
      const result = await heygen
        .listLooks({ ownership: "private", limit: 50, token })
        .catch((err) => this.mapHeyGenError(err));
      for (const look of result.looks) {
        allLooks.push(look);
      }
      if (!result.hasMore || !result.nextToken) break;
      token = result.nextToken;
    }

    const defaultLookId = (process.env.RCLIPPER_AD_LAB_HEYGEN_LOOK_ID ?? "").trim() || undefined;

    return {
      configured: true,
      looks: allLooks.map((l) => ({
        id: l.id,
        name: l.name,
        avatarType: l.avatarType,
        groupId: l.groupId,
        previewImageUrl: l.previewImageUrl,
        previewVideoUrl: l.previewVideoUrl,
        status: l.status,
        supportedApiEngines: l.supportedApiEngines,
        engine: pickEngine(l),
        selectable: pickEngine(l) !== null,
        defaultVoiceId: l.defaultVoiceId,
        imageWidth: l.imageWidth,
        imageHeight: l.imageHeight,
        preferredOrientation: l.preferredOrientation,
      })),
      defaultLookId,
    };
  }

  // ── estimate ───────────────────────────────────────────────────────────────

  async estimate(ownerId: string, draftId: string) {
    const draft = await this.loadDraft(ownerId, draftId);
    if (!draft) throw new AdLabAvatarError("not_found", "ไม่พบร่างสคริปต์");
    if (draft.status !== "approved") throw new AdLabAvatarError("not_approved", "สคริปต์ยังไม่ได้รับการอนุมัติ");

    const text = buildSpokenText(draft);
    const chars = text.length;
    const estSeconds = estimateSpeechSeconds(chars);
    const maxSec = avatarMaxSeconds();
    return {
      chars,
      estSeconds,
      voiceCostUsd: estimateVoiceCostUsd(chars),
      videoCostUsd: estimateAvatarVideoCostUsd(estSeconds),
      scriptHash: scriptHash(text),
      tooLong: chars > ELEVENLABS_V3_MAX_CHARS || estSeconds > maxSec,
    };
  }

  // ── generateVoice ──────────────────────────────────────────────────────────

  async generateVoice(
    ownerId: string,
    params: { draftId: string; voiceId: string; speedId?: AdLabVoiceSpeedId; toneId?: AdLabVoiceToneId }
  ): Promise<{ voice: AdLabAvatarVoice; audioUrl: string; scriptHash: string }> {
    this.assertRealAccount(ownerId);

    const draft = await this.loadDraft(ownerId, params.draftId);
    if (!draft) throw new AdLabAvatarError("not_found", "ไม่พบร่างสคริปต์");
    if (draft.status !== "approved") throw new AdLabAvatarError("not_approved", "สคริปต์ยังไม่ได้รับการอนุมัติ");

    if (!isSupportedAdLabAvatarVoiceId(params.voiceId)) {
      throw new AdLabAvatarError("invalid_voice", `Voice ID ไม่รองรับ: ${params.voiceId}`);
    }

    if (!this._elevenLabsConfigured()) {
      throw new AdLabAvatarError("elevenlabs_not_configured", "ELEVENLABS_API_KEY ยังไม่ได้ตั้งค่า");
    }

    const resolvedSpeedId = resolveSpeedId(params.speedId);
    const resolvedToneId = resolveToneId(params.toneId);
    const speed = getSpeedValue(resolvedSpeedId);
    const toneSettings = getToneVoiceSettings(resolvedToneId);

    const text = buildSpokenText(draft);
    if (!text) throw new AdLabAvatarError("not_found", "สคริปต์ว่างเปล่า ไม่มีข้อความสำหรับอ่าน");

    const maxSec = avatarMaxSeconds();
    const estSeconds = estimateSpeechSeconds(text.length, speed);
    if (text.length > ELEVENLABS_V3_MAX_CHARS || estSeconds > maxSec) {
      throw new AdLabAvatarError(
        "too_long",
        `สคริปต์ยาวเกิน (${text.length} ตัวอักษร, ~${Math.round(estSeconds)} วิ) กรุณาลดความยาวก่อน`
      );
    }

    let audioBuffer: Buffer;
    try {
      audioBuffer = await this._synthesize({
        text,
        voiceId: params.voiceId,
        fetchImpl: this._fetch,
        voiceSettings: { ...toneSettings, speed },
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("ELEVENLABS_API_KEY")) {
        throw new AdLabAvatarError("elevenlabs_not_configured", err.message);
      }
      throw new AdLabAvatarError("provider_error", `ElevenLabs error: ${String(err).slice(0, 200)}`);
    }

    const timestamp = this._now().getTime();
    const audioKey = `${avatarKeyPrefix(ownerId, params.draftId)}voice-${timestamp}.mp3`;

    await spacesSendWithRetry(`avatar upload voice ${audioKey}`, () =>
      this._s3.send(
        new PutObjectCommand({
          Bucket: this._bucket,
          Key: audioKey,
          Body: audioBuffer,
          ContentType: "audio/mpeg",
          ACL: "private",
        })
      )
    );

    const hash = scriptHash(text);
    const estCostUsd = estimateVoiceCostUsd(text.length);
    const voice: AdLabAvatarVoice = {
      voiceId: params.voiceId,
      modelId: AI_CONFIG.elevenLabs.model,
      chars: text.length,
      audioKey,
      estCostUsd,
      speedId: resolvedSpeedId,
      speed,
      toneId: resolvedToneId,
      createdAt: this._now().toISOString(),
    };

    const audioUrl = await this._signUrl(audioKey, 3600);
    return { voice, audioUrl, scriptHash: hash };
  }

  // ── beginImageUpload ───────────────────────────────────────────────────────
  // @deprecated Photo mode replaced by Digital Twin (Avatar V).
  // This method is kept in place but the image-upload API route returns 410.

  async beginImageUpload(
    ownerId: string,
    params: { draftId: string; fileName: string; mimeType: string; fileSizeBytes: number }
  ): Promise<{ uploadUrl: string; imageKey: string }> {
    const draft = await this.loadDraft(ownerId, params.draftId);
    if (!draft) throw new AdLabAvatarError("not_found", "ไม่พบร่างสคริปต์");

    const mime = params.mimeType.toLowerCase().trim();
    if (mime !== "image/jpeg" && mime !== "image/png") {
      throw new AdLabAvatarError("invalid_image", "รองรับเฉพาะ JPEG และ PNG");
    }
    if (params.fileSizeBytes < 1 || params.fileSizeBytes > IMAGE_MAX_BYTES) {
      throw new AdLabAvatarError("invalid_image", "ขนาดรูปต้องอยู่ระหว่าง 1 byte ถึง 10 MB");
    }

    const ext = mime === "image/png" ? "png" : "jpg";
    const uuid = crypto.randomUUID();
    const imageKey = `${avatarKeyPrefix(ownerId, params.draftId)}image-${uuid}.${ext}`;

    const uploadUrl = await getSignedUrl(
      this._s3,
      new PutObjectCommand({
        Bucket: this._bucket,
        Key: imageKey,
        ContentType: mime,
        ContentLength: params.fileSizeBytes,
      }),
      { expiresIn: 3600 }
    );

    return { uploadUrl, imageKey };
  }

  // ── prepareVideoAssets ─────────────────────────────────────────────────────

  /**
   * Fetch the ElevenLabs audio from Spaces and upload it to HeyGen.
   * Returns audioAssetId + HMAC proof token binding it to this owner/draft.
   * Separated from createVideo so a resend can reuse the same asset ID.
   *
   * Image upload is no longer required (Avatar V Digital Twin uses a lookId instead).
   */
  async prepareVideoAssets(
    ownerId: string,
    params: { draftId: string; audioKey: string }
  ): Promise<{ audioAssetId: string; assetToken: string }> {
    this.assertRealAccount(ownerId);

    const draft = await this.loadDraft(ownerId, params.draftId);
    if (!draft) throw new AdLabAvatarError("not_found", "ไม่พบร่างสคริปต์");
    if (draft.status !== "approved") throw new AdLabAvatarError("not_approved", "สคริปต์ยังไม่ได้รับการอนุมัติ");

    if (!isOwnAvatarKey(ownerId, params.draftId, params.audioKey)) {
      throw new AdLabAvatarError("invalid_key", "audioKey ไม่ถูกต้อง");
    }

    const text = buildSpokenText(draft);
    const estSeconds = estimateSpeechSeconds(text.length);
    if (estSeconds > avatarMaxSeconds()) {
      throw new AdLabAvatarError("too_long", "สคริปต์ยาวเกินที่อนุญาต");
    }

    const heygen = this.requireHeyGen();

    const audioRes = await spacesSendWithRetry(`get audio ${params.audioKey}`, () =>
      this._s3.send(new GetObjectCommand({ Bucket: this._bucket, Key: params.audioKey }))
    );

    if (audioRes.ContentLength == null) {
      throw new AdLabAvatarError("provider_error", "ไม่สามารถอ่านขนาดไฟล์เสียงจาก Spaces ได้");
    }
    if (audioRes.ContentLength > AUDIO_MAX_BYTES) {
      throw new AdLabAvatarError("provider_error", "ไฟล์เสียงใหญ่เกิน 50 MB");
    }

    const audioBytes = await streamToBufferWithLimit(
      audioRes.Body as AsyncIterable<Uint8Array>,
      AUDIO_MAX_BYTES,
      "provider_error"
    );

    const audioFileName = params.audioKey.split("/").pop() ?? "voice.mp3";

    const audioAsset = await heygen
      .uploadAsset({ bytes: audioBytes, fileName: audioFileName, contentType: "audio/mpeg" })
      .catch((err) => this.mapHeyGenError(err));

    const secret = this._tokenSecret();
    const assetToken = createHmac("sha256", secret)
      .update(`assets|${ownerId}|${params.draftId}|${audioAsset.assetId}`)
      .digest("hex");

    return { audioAssetId: audioAsset.assetId, assetToken };
  }

  // ── createVideo ────────────────────────────────────────────────────────────

  async createVideo(
    ownerId: string,
    params: {
      draftId: string;
      audioAssetId: string;
      assetToken: string;
      lookId: string;
      idempotencyKey: string;
      voiceChars?: number;
      aspectRatio?: string;
      settings?: unknown;
    }
  ): Promise<{ heygenVideoId: string; jobToken: string; status: string; estCostUsd: number; lookId: string; engine: HeyGenVideoEngine; aspectRatio: HeyGenAspectRatio; appliedSettings: AvatarVideoSettings }> {
    this.assertRealAccount(ownerId);
    const aspectRatio = resolveAspectRatio(params.aspectRatio);
    const requestedSettings = validateSettings(params.settings);

    if (!IDEMPOTENCY_KEY_RE.test(params.idempotencyKey)) {
      throw new AdLabAvatarError(
        "invalid_key",
        "idempotencyKey ต้องประกอบด้วย A-Z a-z 0-9 _ : . - ความยาว 8-255 ตัวอักษร"
      );
    }
    if (!ASSET_ID_RE.test(params.audioAssetId)) {
      throw new AdLabAvatarError("invalid_key", "audioAssetId ไม่ถูกต้อง");
    }
    if (!LOOK_ID_RE.test(params.lookId)) {
      throw new AdLabAvatarError("invalid_key", "lookId ไม่ถูกต้อง");
    }

    // Verify assetToken (constant-time).
    const secret = this._tokenSecret();
    const expected = createHmac("sha256", secret)
      .update(`assets|${ownerId}|${params.draftId}|${params.audioAssetId}`)
      .digest();

    let provided: Buffer;
    try {
      if (params.assetToken.length === 0 || params.assetToken.length % 2 !== 0) {
        throw new Error("odd length");
      }
      provided = Buffer.from(params.assetToken, "hex");
      if (provided.toString("hex") !== params.assetToken.toLowerCase()) {
        throw new Error("non-hex");
      }
    } catch {
      throw new AdLabAvatarError("invalid_token", "assetToken ไม่ถูกต้อง");
    }

    const validLength = expected.length === provided.length;
    const match = validLength && timingSafeEqual(expected, validLength ? provided : expected);
    if (!match) throw new AdLabAvatarError("invalid_token", "assetToken ไม่ถูกต้อง");

    const draft = await this.loadDraft(ownerId, params.draftId);
    if (!draft) throw new AdLabAvatarError("not_found", "ไม่พบร่างสคริปต์");
    if (draft.status !== "approved") throw new AdLabAvatarError("not_approved", "สคริปต์ยังไม่ได้รับการอนุมัติ");

    const text = buildSpokenText(draft);
    // Speed-adjusted: the stored voice's speed (legacy voices without one = 1.0).
    const voiceSpeed = draft.avatar?.voice?.speed && draft.avatar.voice.speed > 0 ? draft.avatar.voice.speed : 1;
    const estSeconds = estimateSpeechSeconds(Math.max(text.length, params.voiceChars ?? 0), voiceSpeed);
    if (estSeconds > avatarMaxSeconds()) {
      throw new AdLabAvatarError("too_long", "สคริปต์ยาวเกินที่อนุญาต");
    }

    const heygen = this.requireHeyGen();

    // Validate the look before submitting to avoid a wasted API call.
    const look = await heygen.getLook(params.lookId).catch((err) => this.mapHeyGenError(err));
    if (!look) {
      throw new AdLabAvatarError("look_not_found", `ไม่พบ Look ID: ${params.lookId}`);
    }
    const engine = pickEngine(look);
    if (!engine) {
      throw new AdLabAvatarError(
        "look_not_eligible",
        `Look "${look.name}" ยังใช้สร้างวิดีโอไม่ได้ (ต้อง status completed และรองรับ avatar_v หรือ avatar_iv)`
      );
    }
    const appliedSettings = withDefaultFit(
      applicableSettings(requestedSettings, { engine, avatarType: look.avatarType, mode: "audio" }),
      aspectRatio,
      { width: look.imageWidth, height: look.imageHeight, orientation: look.preferredOrientation }
    );

    const videoResult = await heygen
      .createAvatarVVideo({
        avatarId: params.lookId,
        audioAssetId: params.audioAssetId,
        idempotencyKey: params.idempotencyKey,
        engine,
        settings: appliedSettings,
        aspectRatio,
        resolution: "1080p",
      })
      .catch((err) => this.mapHeyGenError(err));

    const { videoId, status } = videoResult;
    const jobToken = createHmac("sha256", secret)
      .update(`${ownerId}|${params.draftId}|${videoId}`)
      .digest("hex");

    const estCostUsd = estimateAvatarVideoCostUsd(estSeconds, engine, look.avatarType);
    return { heygenVideoId: videoId, jobToken, status, estCostUsd, lookId: params.lookId, engine, aspectRatio, appliedSettings };
  }

  // ── createTtsVideo ─────────────────────────────────────────────────────────

  /**
   * Submit a HeyGen Avatar V video job using HeyGen's built-in TTS.
   * Server resolves defaultVoiceId from the look — never trusts client-supplied voice IDs.
   * No ElevenLabs audio needed; validates script length the same way as generateVoice.
   */
  async createTtsVideo(
    ownerId: string,
    params: {
      draftId: string;
      lookId: string;
      script: string;
      idempotencyKey: string;
      kind: "test" | "production";
      aspectRatio?: string;
      settings?: unknown;
    }
  ): Promise<{ heygenVideoId: string; jobToken: string; status: string; estCostUsd: number; lookId: string; engine: HeyGenVideoEngine; defaultVoiceId: string; aspectRatio: HeyGenAspectRatio; appliedSettings: AvatarVideoSettings }> {
    this.assertRealAccount(ownerId);
    const aspectRatio = resolveAspectRatio(params.aspectRatio);
    const requestedSettings = validateSettings(params.settings);

    if (!IDEMPOTENCY_KEY_RE.test(params.idempotencyKey)) {
      throw new AdLabAvatarError(
        "invalid_key",
        "idempotencyKey ต้องประกอบด้วย A-Z a-z 0-9 _ : . - ความยาว 8-255 ตัวอักษร"
      );
    }
    if (!LOOK_ID_RE.test(params.lookId)) {
      throw new AdLabAvatarError("invalid_key", "lookId ไม่ถูกต้อง");
    }

    const script = params.script.trim();
    if (!script) {
      throw new AdLabAvatarError("not_found", "สคริปต์ว่างเปล่า");
    }
    if (script.length > ELEVENLABS_V3_MAX_CHARS) {
      throw new AdLabAvatarError("too_long", `สคริปต์ยาวเกิน ${ELEVENLABS_V3_MAX_CHARS} ตัวอักษร`);
    }
    const estSeconds = estimateSpeechSeconds(script.length);
    if (estSeconds > avatarMaxSeconds()) {
      throw new AdLabAvatarError("too_long", "สคริปต์ยาวเกินที่อนุญาต");
    }

    // Validate the draft exists for production mode (test mode skips this).
    if (params.kind === "production") {
      const draft = await this.loadDraft(ownerId, params.draftId);
      if (!draft) throw new AdLabAvatarError("not_found", "ไม่พบร่างสคริปต์");
      if (draft.status !== "approved") throw new AdLabAvatarError("not_approved", "สคริปต์ยังไม่ได้รับการอนุมัติ");
    }

    const heygen = this.requireHeyGen();

    // Resolve defaultVoiceId from the look server-side.
    const look = await heygen.getLook(params.lookId).catch((err) => this.mapHeyGenError(err));
    if (!look) {
      throw new AdLabAvatarError("look_not_found", `ไม่พบ Look ID: ${params.lookId}`);
    }
    const engine = pickEngine(look);
    if (!engine) {
      throw new AdLabAvatarError(
        "look_not_eligible",
        `Look "${look.name}" ยังใช้สร้างวิดีโอไม่ได้ (ต้อง status completed และรองรับ avatar_v หรือ avatar_iv)`
      );
    }
    const appliedSettings = withDefaultFit(
      applicableSettings(requestedSettings, { engine, avatarType: look.avatarType, mode: "tts" }),
      aspectRatio,
      { width: look.imageWidth, height: look.imageHeight, orientation: look.preferredOrientation }
    );
    const defaultVoiceId = look.defaultVoiceId;
    if (!defaultVoiceId) {
      throw new AdLabAvatarError(
        "tts_voice_missing",
        `Look "${look.name}" ไม่มี default voice — ไม่สามารถใช้ HeyGen TTS ได้`
      );
    }

    const videoResult = await heygen
      .createTtsVideo({
        avatarId: params.lookId,
        voiceId: defaultVoiceId,
        script,
        idempotencyKey: params.idempotencyKey,
        engine,
        settings: appliedSettings,
        aspectRatio,
        resolution: "1080p",
      })
      .catch((err) => this.mapHeyGenError(err));

    const secret = this._tokenSecret();
    const { videoId, status } = videoResult;
    const jobToken = createHmac("sha256", secret)
      .update(`${ownerId}|${params.draftId}|${videoId}`)
      .digest("hex");

    const estCostUsd = estimateAvatarVideoCostUsd(estSeconds, engine, look.avatarType);
    return { heygenVideoId: videoId, jobToken, status, estCostUsd, lookId: params.lookId, engine, defaultVoiceId, aspectRatio, appliedSettings };
  }

  // ── deleteVideoFile ────────────────────────────────────────────────────────

  /**
   * Delete an avatar video file from Spaces.
   * Only keys that start with avatarKeyPrefix(ownerId, draftId) are permitted.
   * Does NOT modify the workspace — the client removes the entry from videos[].
   */
  async deleteVideoFile(
    ownerId: string,
    params: { draftId: string; videoKey: string }
  ): Promise<void> {
    this.assertRealAccount(ownerId);
    if (params.videoKey.includes("..") || !isOwnAvatarKey(ownerId, params.draftId, params.videoKey)) {
      throw new AdLabAvatarError("invalid_key", "videoKey ไม่ถูกต้องหรือไม่ใช่ของคุณ");
    }
    await spacesSendWithRetry(`delete avatar video ${params.videoKey}`, () =>
      this._s3.send(new DeleteObjectCommand({ Bucket: this._bucket, Key: params.videoKey }))
    );
  }

  // ── getVideoStatus ─────────────────────────────────────────────────────────

  async getVideoStatus(
    ownerId: string,
    params: { draftId: string; videoId: string; token: string }
  ): Promise<{
    status: "queued" | "processing" | "failed" | "ready";
    error?: string;
    videoKey?: string;
    videoUrl?: string;
    downloadUrl?: string;
    durationSec?: number;
    retryAfterSeconds?: number;
  }> {
    const secret = this._tokenSecret();
    const expected = createHmac("sha256", secret)
      .update(`${ownerId}|${params.draftId}|${params.videoId}`)
      .digest();
    const provided = Buffer.from(params.token, "hex");
    const validLength = expected.length === provided.length;
    const match = validLength && timingSafeEqual(expected, validLength ? provided : expected);
    if (!match) throw new AdLabAvatarError("invalid_token", "token ไม่ถูกต้อง");

    const heygen = this.requireHeyGen();
    const heygenStatus = await heygen.getVideo(params.videoId).catch((err) => this.mapHeyGenError(err));

    const { status, videoUrl, duration, failureMessage } = heygenStatus;

    if (status === "waiting" || status === "pending") {
      return { status: "queued" };
    }
    if (status === "processing") {
      return { status: "processing" };
    }
    if (status === "failed") {
      return { status: "failed", error: failureMessage ?? "HeyGen generation failed" };
    }
    if (status !== "completed") {
      return { status: "processing" };
    }

    // Completed — copy the MP4 into our Spaces bucket (idempotent).
    const videoKey = `${avatarKeyPrefix(ownerId, params.draftId)}video-${params.videoId}.mp4`;

    let alreadyCopied = false;
    try {
      await this._s3.send(new HeadObjectCommand({ Bucket: this._bucket, Key: videoKey }));
      alreadyCopied = true;
    } catch (err) {
      const meta = err as { $metadata?: { httpStatusCode?: number }; name?: string };
      const notFound = meta?.$metadata?.httpStatusCode === 404 || meta?.name === "NotFound";
      if (!notFound) {
        throw new AdLabAvatarError("provider_error", "Could not check the avatar video in Spaces.");
      }
    }

    if (!alreadyCopied && !videoUrl) {
      return { status: "processing" };
    }

    if (!alreadyCopied && videoUrl) {
      const videoRes = await this._fetch(videoUrl);
      if (!videoRes.ok || !videoRes.body) {
        throw new AdLabAvatarError("provider_error", `ดาวน์โหลดวิดีโอจาก HeyGen ล้มเหลว: ${videoRes.status}`);
      }
      await this._uploadStream({
        key: videoKey,
        body: videoRes.body as ReadableStream<Uint8Array>,
        contentType: "video/mp4",
        acl: "private",
        client: this._s3,
        bucket: this._bucket,
        maxBytes: 1024 * 1024 * 1024, // 1 GB
      });
    }

    const [signedVideoUrl, signedDownloadUrl] = await Promise.all([
      this._signUrl(videoKey, 3600),
      this._signUrl(videoKey, 3600, { downloadFileName: `avatar-${params.draftId}.mp4` }),
    ]);

    return {
      status: "ready",
      videoKey,
      videoUrl: signedVideoUrl,
      downloadUrl: signedDownloadUrl,
      durationSec: duration,
    };
  }

  // ── Twin creation ──────────────────────────────────────────────────────────

  private static readonly TWIN_VIDEO_MAX_BYTES = 209_715_200; // 200 MB
  private static readonly TWIN_VIDEO_MIN_SEC = 15;
  private static readonly TWIN_VIDEO_MAX_SEC = 600;
  private static readonly TWIN_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

  /**
   * Validate the video file and request a pre-signed direct-upload URL from HeyGen.
   * The browser will PUT the raw bytes to uploadUrl using uploadHeaders verbatim.
   */
  async initiateTwinUpload(
    ownerId: string,
    params: { fileName: string; contentType: string; sizeBytes: number; durationSec?: number }
  ): Promise<{ assetId: string; uploadUrl: string; uploadHeaders: Record<string, string> }> {
    this.assertRealAccount(ownerId);

    const ct = params.contentType.toLowerCase().trim();
    if (!AdLabAvatarService.TWIN_VIDEO_TYPES.has(ct)) {
      throw new AdLabAvatarError("twin_type_invalid", "รองรับเฉพาะ video/mp4 และ video/webm");
    }
    if (params.sizeBytes <= 0 || params.sizeBytes > AdLabAvatarService.TWIN_VIDEO_MAX_BYTES) {
      throw new AdLabAvatarError(
        "twin_too_large",
        `ขนาดไฟล์ต้องไม่เกิน ${Math.round(AdLabAvatarService.TWIN_VIDEO_MAX_BYTES / 1024 / 1024)} MB`
      );
    }
    if (
      params.durationSec != null &&
      (params.durationSec < AdLabAvatarService.TWIN_VIDEO_MIN_SEC ||
        params.durationSec > AdLabAvatarService.TWIN_VIDEO_MAX_SEC)
    ) {
      throw new AdLabAvatarError(
        "twin_duration_invalid",
        `ความยาวคลิปต้องอยู่ระหว่าง ${AdLabAvatarService.TWIN_VIDEO_MIN_SEC}–${AdLabAvatarService.TWIN_VIDEO_MAX_SEC} วินาที`
      );
    }

    const heygen = this.requireHeyGen();
    const result = await heygen
      .initiateDirectUpload({
        fileName: params.fileName,
        contentType: ct,
        sizeBytes: params.sizeBytes,
      })
      .catch((err) => this.mapHeyGenError(err));

    return {
      assetId: result.assetId,
      uploadUrl: result.uploadUrl,
      uploadHeaders: result.uploadHeaders,
    };
  }

  /**
   * Mark a direct-upload as complete. Call this after the browser finishes the PUT.
   */
  async completeTwinUpload(ownerId: string, params: { assetId: string }): Promise<void> {
    this.assertRealAccount(ownerId);
    if (!ASSET_ID_RE.test(params.assetId)) {
      throw new AdLabAvatarError("invalid_key", "assetId ไม่ถูกต้อง");
    }
    const heygen = this.requireHeyGen();
    await heygen
      .completeDirectUpload(params.assetId)
      .catch((err) => this.mapHeyGenError(err));
  }

  /**
   * Create a Digital Twin from an uploaded video asset.
   * Pass avatarGroupId to attach the new look to an existing twin identity.
   * Returns lookId + groupId needed for consent and status polling.
   *
   * Optional client-reported dimensions (durationSec, clientWidth, clientHeight) are
   * validated server-side where feasible; true orientation is verified by HeyGen after
   * training — check look image_width/height on completion and surface a warning if the
   * resulting look turns out to be landscape when portrait was intended.
   */
  async createTwin(
    ownerId: string,
    params: {
      name: string;
      assetId: string;
      idempotencyKey: string;
      /** Optional: attach the new look to this existing avatar group. */
      avatarGroupId?: string;
      /** Client-reported video duration (seconds). Validated 15–600 when provided. */
      clientDurationSec?: number;
      /** Client-reported video pixel width. Used with clientHeight to enforce portrait. */
      clientWidth?: number;
      /** Client-reported video pixel height. Portrait requires height > width. */
      clientHeight?: number;
    }
  ): Promise<{ lookId: string; groupId: string; defaultVoiceId?: string }> {
    this.assertRealAccount(ownerId);

    const name = params.name.trim();
    if (!name) throw new AdLabAvatarError("invalid_key", "ชื่อ Digital Twin ต้องไม่ว่างเปล่า");
    if (!ASSET_ID_RE.test(params.assetId)) {
      throw new AdLabAvatarError("invalid_key", "assetId ไม่ถูกต้อง");
    }
    if (!IDEMPOTENCY_KEY_RE.test(params.idempotencyKey)) {
      throw new AdLabAvatarError(
        "invalid_key",
        "idempotencyKey ต้องประกอบด้วย A-Z a-z 0-9 _ : . - ความยาว 8-255 ตัวอักษร"
      );
    }
    if (params.avatarGroupId !== undefined && !LOOK_ID_RE.test(params.avatarGroupId)) {
      throw new AdLabAvatarError("invalid_key", "avatarGroupId ไม่ถูกต้อง");
    }
    if (
      params.clientDurationSec !== undefined &&
      (params.clientDurationSec < AdLabAvatarService.TWIN_VIDEO_MIN_SEC ||
        params.clientDurationSec > AdLabAvatarService.TWIN_VIDEO_MAX_SEC)
    ) {
      throw new AdLabAvatarError(
        "twin_duration_invalid",
        `ความยาวคลิปต้องอยู่ระหว่าง ${AdLabAvatarService.TWIN_VIDEO_MIN_SEC}–${AdLabAvatarService.TWIN_VIDEO_MAX_SEC} วินาที`
      );
    }
    if (
      params.clientWidth !== undefined &&
      params.clientHeight !== undefined &&
      params.clientHeight <= params.clientWidth
    ) {
      throw new AdLabAvatarError(
        "twin_duration_invalid",
        "วิดีโอสำหรับ Look แนวตั้งต้องมีความสูงมากกว่าความกว้าง (portrait: height > width)"
      );
    }

    const heygen = this.requireHeyGen();
    const result = await heygen
      .createDigitalTwin({
        name,
        assetId: params.assetId,
        idempotencyKey: params.idempotencyKey,
        avatarGroupId: params.avatarGroupId,
      })
      .catch((err) => this.mapHeyGenError(err));

    return { lookId: result.lookId, groupId: result.groupId, defaultVoiceId: result.defaultVoiceId };
  }

  /**
   * Request (or refresh) the consent URL for a Digital Twin group.
   * HeyGen returns 400 if consent is already accepted or under review.
   */
  async requestTwinConsentUrl(
    ownerId: string,
    params: { groupId: string }
  ): Promise<{ url: string; consentStatus: string }> {
    this.assertRealAccount(ownerId);
    if (!LOOK_ID_RE.test(params.groupId)) {
      throw new AdLabAvatarError("invalid_key", "groupId ไม่ถูกต้อง");
    }
    const heygen = this.requireHeyGen();
    try {
      return await heygen.requestTwinConsent(params.groupId);
    } catch (err) {
      if (err instanceof HeyGenApiError && err.status === 400) {
        throw new AdLabAvatarError(
          "twin_consent_conflict",
          "การยืนยันตัวตนได้รับการยืนยันหรืออยู่ระหว่างการพิจารณาแล้ว"
        );
      }
      return this.mapHeyGenError(err);
    }
  }

  /**
   * Poll the look and/or group status for a Digital Twin in training.
   */
  async getTwinStatus(
    ownerId: string,
    params: { lookId?: string; groupId?: string }
  ): Promise<{
    lookStatus?: string;
    avatarV: boolean;
    consentStatus?: string;
    error?: string;
  }> {
    this.assertRealAccount(ownerId);
    const heygen = this.requireHeyGen();

    let lookStatus: string | undefined;
    let avatarV = false;
    let errorMsg: string | undefined;

    if (params.lookId) {
      if (!LOOK_ID_RE.test(params.lookId)) {
        throw new AdLabAvatarError("invalid_key", "lookId ไม่ถูกต้อง");
      }
      const look = await heygen.getLook(params.lookId).catch((err) => this.mapHeyGenError(err));
      if (look) {
        lookStatus = look.status;
        avatarV = look.supportedApiEngines.includes("avatar_v");
        // HeyGen training failures surface as error codes on the look.
        if (look.status === "failed") {
          errorMsg = "การสร้าง Digital Twin ล้มเหลว (ตรวจสอบ HeyGen Dashboard)";
        }
      }
    }

    let consentStatus: string | undefined;

    if (params.groupId) {
      if (!LOOK_ID_RE.test(params.groupId)) {
        throw new AdLabAvatarError("invalid_key", "groupId ไม่ถูกต้อง");
      }
      const group = await heygen
        .getAvatarGroup(params.groupId)
        .catch((err) => this.mapHeyGenError(err));
      consentStatus = group.consentStatus;
      if (group.consentStatus === "rejected" && group.error?.message) {
        errorMsg = `ยืนยันตัวตนถูกปฏิเสธ: ${group.error.message}`;
      }
    }

    return { lookStatus, avatarV, consentStatus, ...(errorMsg ? { error: errorMsg } : {}) };
  }

  // ── signedMedia ────────────────────────────────────────────────────────────

  async signedMedia(
    ownerId: string,
    params: { key: string; draftId: string; download?: boolean }
  ): Promise<{ url: string }> {
    if (!isOwnAvatarKey(ownerId, params.draftId, params.key)) {
      throw new AdLabAvatarError("invalid_key", "key ไม่ถูกต้องหรือไม่ใช่ของคุณ");
    }
    const url = await this._signUrl(
      params.key,
      3600,
      params.download
        ? { downloadFileName: params.key.split("/").pop() ?? "avatar-media" }
        : undefined
    );
    return { url };
  }

  // ---------------------------------------------------------------------------

  private requireHeyGen(): HeyGenClient {
    try {
      return this._heygenFactory();
    } catch (err) {
      if (err instanceof HeyGenNotConfiguredError) {
        throw new AdLabAvatarError("heygen_not_configured", err.message);
      }
      throw err;
    }
  }

  private assertRealAccount(userId: string): void {
    if (isAdLabLocalUserId(userId)) {
      throw new AdLabAvatarError(
        "local_account",
        "ฟีเจอร์ Avatar ต้องเข้าสู่ระบบด้วยบัญชี RClipper จริง (ไม่ใช่ local login)"
      );
    }
  }

  private mapHeyGenError(err: unknown): never {
    if (err instanceof HeyGenNotConfiguredError) {
      throw new AdLabAvatarError("heygen_not_configured", err.message);
    }
    if (err instanceof HeyGenApiError) {
      if (err.status === 429) {
        throw new AdLabAvatarError("rate_limited", "HeyGen rate limited — ลองใหม่ภายหลัง", err.retryAfterSeconds);
      }
      throw new AdLabAvatarError("provider_error", `HeyGen error ${err.status}: ${err.message}`);
    }
    throw new AdLabAvatarError("provider_error", `HeyGen error: ${String(err).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------

async function streamToBufferWithLimit(
  stream: AsyncIterable<Uint8Array> | undefined,
  maxBytes: number,
  errorCode: "provider_error" | "invalid_image"
): Promise<Buffer> {
  if (!stream) throw new AdLabAvatarError(errorCode, "Empty S3 response body");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new AdLabAvatarError(
        errorCode,
        `ไฟล์ใหญ่เกินขีดจำกัด (${Math.round(maxBytes / 1024 / 1024)} MB)`
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}


import type { HeyGenAspectRatio } from "@/config/heygenAspectRatios";
import type { AvatarVideoSettings } from "@/config/heygenVideoOptions";
/**
 * HeyGen v3 API client — Avatar V Digital Twin.
 *
 * All methods require a valid API key; the key is read from
 * process.env.HEYGEN_API_KEY at construction time (never at module load) so
 * the module is safe to import in test environments without the key set.
 *
 * Error hierarchy:
 *   HeyGenNotConfiguredError  — API key absent at construction
 *   HeyGenApiError            — non-2xx API response (carries status + HeyGen code)
 */

export class HeyGenNotConfiguredError extends Error {
  constructor() {
    super("HEYGEN_API_KEY is not set. Configure it in .env.local to use the Avatar feature.");
    this.name = "HeyGenNotConfiguredError";
  }
}

export class HeyGenApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "HeyGenApiError";
  }
}

/** Returns true when HEYGEN_API_KEY is present and non-empty. */
export function isHeyGenConfigured(): boolean {
  return Boolean((process.env.HEYGEN_API_KEY ?? "").trim());
}

export type HeyGenVideoEngine = "avatar_v" | "avatar_iv";

export interface HeyGenLook {
  id: string;
  name: string;
  avatarType: string;
  groupId?: string;
  supportedApiEngines: string[];
  status?: string;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  defaultVoiceId?: string;
  /** Native look size and orientation (GET /v3/avatars/looks). */
  imageWidth?: number;
  imageHeight?: number;
  preferredOrientation?: "portrait" | "landscape" | "square";
}

export interface HeyGenDirectUploadResult {
  assetId: string;
  uploadUrl: string;
  /** Headers the browser must include verbatim in the PUT request (e.g. Content-Type, Content-Length). */
  uploadHeaders: Record<string, string>;
  expiresInSeconds: number;
  maxBytes: number;
}

export interface HeyGenDigitalTwinResult {
  lookId: string;
  groupId: string;
  defaultVoiceId?: string;
}

export interface HeyGenConsentResult {
  url: string;
  consentStatus: string;
}

export interface HeyGenAvatarGroupStatus {
  consentStatus: string;
  error?: { message: string };
}

interface HeyGenClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class HeyGenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(options: HeyGenClientOptions = {}) {
    const key = (options.apiKey ?? process.env.HEYGEN_API_KEY ?? "").trim();
    if (!key) throw new HeyGenNotConfiguredError();
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? "https://api.heygen.com").replace(/\/$/, "");
    this.fetch = options.fetchImpl ?? fetch;
  }

  /**
   * Upload a raw asset (audio) to HeyGen and return its asset ID.
   * Uses multipart/form-data POST to /v3/assets.
   */
  async uploadAsset(params: {
    bytes: Buffer | Uint8Array;
    fileName: string;
    contentType: string;
  }): Promise<{ assetId: string }> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(params.bytes)], { type: params.contentType }),
      params.fileName
    );

    const res = await this.fetch(`${this.baseUrl}/v3/assets`, {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey },
      body: form,
    });

    const data = await this.parseResponse<{ data?: { id?: string; asset_id?: string } }>(res, "POST /v3/assets");
    const assetId: string | undefined = data?.data?.id ?? data?.data?.asset_id;
    if (!assetId) {
      throw new HeyGenApiError(res.status, "missing_asset_id", "HeyGen /v3/assets: no id in response");
    }
    return { assetId };
  }

  /**
   * List avatar looks, optionally filtered by type and ownership.
   * Paginate via nextToken (returned when hasMore is true).
   */
  async listLooks(params?: {
    avatarType?: string;
    ownership?: string;
    limit?: number;
    token?: string;
  }): Promise<{ looks: HeyGenLook[]; hasMore: boolean; nextToken?: string }> {
    const qs = new URLSearchParams();
    if (params?.avatarType) qs.set("avatar_type", params.avatarType);
    if (params?.ownership) qs.set("ownership", params.ownership);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.token) qs.set("token", params.token);

    const url = `${this.baseUrl}/v3/avatars/looks?${qs.toString()}`;
    const res = await this.fetch(url, { headers: { "X-Api-Key": this.apiKey } });

    type RawLook = {
      id: string;
      name: string;
      avatar_type: string;
      group_id?: string;
      gender?: string;
      supported_api_engines?: string[];
      status?: string;
      preview_image_url?: string;
      preview_video_url?: string;
      default_voice_id?: string;
      image_width?: number | null;
      image_height?: number | null;
      preferred_orientation?: "portrait" | "landscape" | "square" | null;
    };
    // Documented v3 shape: { data: RawLook[], has_more, next_token } (top level).
    // The legacy nested shape { data: { looks, has_more, next_token } } is still accepted.
    const parsed = await this.parseResponse<{
      has_more?: boolean;
      next_token?: string | null;
      data?: RawLook[] | {
        looks?: Array<RawLook>;
        has_more?: boolean;
        next_token?: string;
      };
    }>(res, "GET /v3/avatars/looks");

    const data = parsed?.data;
    const nested = data && !Array.isArray(data) ? data : undefined;
    const raw: RawLook[] = Array.isArray(data) ? data : (nested?.looks ?? []);
    const looks: HeyGenLook[] = raw.map((l) => ({
      id: l.id,
      name: l.name,
      avatarType: l.avatar_type,
      groupId: l.group_id ?? undefined,
      supportedApiEngines: l.supported_api_engines ?? [],
      status: l.status,
      previewImageUrl: l.preview_image_url,
      previewVideoUrl: l.preview_video_url,
      defaultVoiceId: l.default_voice_id ?? undefined,
      imageWidth: l.image_width ?? undefined,
      imageHeight: l.image_height ?? undefined,
      preferredOrientation: l.preferred_orientation ?? undefined,
    }));
    return {
      looks,
      hasMore: parsed?.has_more ?? nested?.has_more ?? false,
      nextToken: (parsed?.next_token ?? nested?.next_token) || undefined,
    };
  }

  /**
   * Fetch a single look by ID.
   * Returns null when the API returns 404 rather than throwing.
   */
  async getLook(lookId: string): Promise<HeyGenLook | null> {
    const res = await this.fetch(
      `${this.baseUrl}/v3/avatars/looks/${encodeURIComponent(lookId)}`,
      { headers: { "X-Api-Key": this.apiKey } }
    );

    if (res.status === 404) {
      await res.text().catch(() => "");
      return null;
    }

    const parsed = await this.parseResponse<{
      data?: {
        id?: string;
        name?: string;
        avatar_type?: string;
        supported_api_engines?: string[];
        status?: string;
        preview_image_url?: string;
        preview_video_url?: string;
        default_voice_id?: string;
        image_width?: number | null;
        image_height?: number | null;
        preferred_orientation?: "portrait" | "landscape" | "square" | null;
      };
    }>(res, `GET /v3/avatars/looks/${lookId}`);

    const d = parsed?.data;
    if (!d?.id) return null;
    return {
      id: d.id,
      name: d.name ?? "",
      avatarType: d.avatar_type ?? "",
      supportedApiEngines: d.supported_api_engines ?? [],
      status: d.status,
      previewImageUrl: d.preview_image_url,
      previewVideoUrl: d.preview_video_url,
      defaultVoiceId: d.default_voice_id ?? undefined,
      imageWidth: d.image_width ?? undefined,
      imageHeight: d.image_height ?? undefined,
      preferredOrientation: d.preferred_orientation ?? undefined,
    };
  }

  /**
   * Submit an Avatar V Digital Twin video generation job.
   * Engine is always {type:"avatar_v"} — never sent by the client.
   * Returns the new video ID and its initial status.
   */
  async createAvatarVVideo(params: {
    avatarId: string;
    audioAssetId: string;
    idempotencyKey: string;
    aspectRatio: HeyGenAspectRatio;
    resolution: "1080p";
    title?: string;
    /** Chosen server-side from the look's supported_api_engines. Default avatar_v. */
    engine?: HeyGenVideoEngine;
    /** Optional advanced settings (already filtered to applicable fields). */
    settings?: AvatarVideoSettings;
  }): Promise<{ videoId: string; status: string }> {
    const HEYGEN_ENGINE: HeyGenVideoEngine = params.engine ?? "avatar_v";
    const s = params.settings;

    const body: Record<string, unknown> = {
      type: "avatar",
      avatar_id: params.avatarId,
      engine: { type: HEYGEN_ENGINE },
      audio_asset_id: params.audioAssetId,
      aspect_ratio: params.aspectRatio,
      resolution: s?.resolution ?? params.resolution,
    };
    // settings.title overrides params.title
    const titleToUse = s?.title ?? params.title;
    if (titleToUse) body.title = titleToUse;
    if (s) {
      if (s.fit !== undefined) body.fit = s.fit;
      if (s.background !== undefined) body.background = s.background;
      if (s.remove_background !== undefined) body.remove_background = s.remove_background;
      if (s.motion_prompt !== undefined) body.motion_prompt = s.motion_prompt;
      if (s.expressiveness !== undefined) body.expressiveness = s.expressiveness;
      if (s.caption !== undefined) body.caption = s.caption;
      // voice_settings not used in audio mode (filtered out by applicableSettings upstream)
    }

    const res = await this.fetch(`${this.baseUrl}/v3/videos`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": params.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const parsed = await this.parseResponse<{ data?: { video_id?: string; status?: string } }>(
      res,
      "POST /v3/videos (avatar_v)"
    ).catch((err: unknown) => {
      // Diagnostics: body KEYS only, never values or the API key.
      console.warn(`[heygen] ${"POST /v3/videos (avatar_v)"} failed; body keys: ${Object.keys(body).sort().join(",")}`);
      throw err;
    });
    const videoId: string | undefined = parsed?.data?.video_id;
    const status: string = parsed?.data?.status ?? "pending";
    if (!videoId) {
      throw new HeyGenApiError(res.status, "missing_video_id", "HeyGen /v3/videos: no video_id in response");
    }
    return { videoId, status };
  }

  /**
   * Poll a video generation job for status and, once complete, the final URL.
   */
  async getVideo(videoId: string): Promise<{
    status: "waiting" | "pending" | "processing" | "completed" | "failed" | string;
    videoUrl?: string;
    thumbnailUrl?: string;
    duration?: number;
    failureMessage?: string;
    failureCode?: string;
  }> {
    const res = await this.fetch(`${this.baseUrl}/v3/videos/${encodeURIComponent(videoId)}`, {
      headers: { "X-Api-Key": this.apiKey },
    });

    const parsed = await this.parseResponse<{
      data?: {
        status?: string;
        video_url?: string;
        thumbnail_url?: string;
        duration?: number;
        failure_message?: string;
        failure_code?: string;
      };
    }>(res, `GET /v3/videos/${videoId}`);
    const d = parsed?.data ?? {};
    return {
      status: d.status ?? "pending",
      videoUrl: d.video_url,
      thumbnailUrl: d.thumbnail_url,
      duration: d.duration,
      failureMessage: d.failure_message,
      failureCode: d.failure_code,
    };
  }

  /**
   * Initiate a direct upload for a large video asset (up to 200 MB).
   * POST /v3/assets/direct-uploads
   * The caller receives a pre-signed PUT URL. The browser PUTs the raw bytes
   * directly to that URL using the returned uploadHeaders verbatim.
   * NOTE: if the pre-signed bucket rejects browser CORS (missing
   * Access-Control-Allow-Origin), a server-side streaming proxy would be
   * needed instead of a direct browser PUT.
   */
  async initiateDirectUpload(params: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<HeyGenDirectUploadResult> {
    const res = await this.fetch(`${this.baseUrl}/v3/assets/direct-uploads`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: params.fileName,
        content_type: params.contentType,
        size_bytes: params.sizeBytes,
      }),
    });

    const parsed = await this.parseResponse<{
      data?: {
        asset_id?: string;
        upload_url?: string;
        upload_headers?: Record<string, string>;
        expires_in_seconds?: number;
        max_bytes?: number;
      };
    }>(res, "POST /v3/assets/direct-uploads");

    const d = parsed?.data;
    if (!d?.asset_id || !d?.upload_url) {
      throw new HeyGenApiError(
        res.status,
        "missing_upload_data",
        "HeyGen /v3/assets/direct-uploads: missing asset_id or upload_url in response"
      );
    }
    return {
      assetId: d.asset_id,
      uploadUrl: d.upload_url,
      uploadHeaders: d.upload_headers ?? {},
      expiresInSeconds: d.expires_in_seconds ?? 3600,
      maxBytes: d.max_bytes ?? 209_715_200,
    };
  }

  /**
   * Mark a direct-upload asset as upload-complete (idempotent).
   * POST /v3/assets/{asset_id}/complete
   */
  async completeDirectUpload(assetId: string): Promise<void> {
    const res = await this.fetch(
      `${this.baseUrl}/v3/assets/${encodeURIComponent(assetId)}/complete`,
      {
        method: "POST",
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );
    // 404 can mean the asset was already cleaned up but complete was already called — treat as ok.
    if (!res.ok && res.status !== 404) {
      await this.parseResponse<unknown>(res, `POST /v3/assets/${assetId}/complete`);
    } else {
      await res.text().catch(() => "");
    }
  }

  /**
   * Create a Digital Twin avatar from an uploaded video asset.
   * POST /v3/avatars with Idempotency-Key header.
   * Parses avatar_item.id (lookId) and avatar_group.id (groupId) defensively.
   */
  async createDigitalTwin(params: {
    name: string;
    assetId: string;
    idempotencyKey: string;
    /** Optional: attach new look to an existing avatar group (identity). */
    avatarGroupId?: string;
  }): Promise<HeyGenDigitalTwinResult> {
    const body: Record<string, unknown> = {
      type: "digital_twin",
      name: params.name,
      file: { type: "asset_id", asset_id: params.assetId },
    };
    if (params.avatarGroupId) body.avatar_group_id = params.avatarGroupId;
    const res = await this.fetch(`${this.baseUrl}/v3/avatars`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": params.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const parsed = await this.parseResponse<{
      data?: {
        avatar_item?: { id?: string; default_voice_id?: string };
        avatar_group?: { id?: string };
      };
    }>(res, "POST /v3/avatars");

    const lookId = parsed?.data?.avatar_item?.id;
    const groupId = parsed?.data?.avatar_group?.id;
    if (!lookId || !groupId) {
      throw new HeyGenApiError(
        res.status,
        "missing_avatar_data",
        "HeyGen /v3/avatars: missing avatar_item.id or avatar_group.id in response"
      );
    }
    return {
      lookId,
      groupId,
      defaultVoiceId: parsed?.data?.avatar_item?.default_voice_id,
    };
  }

  /**
   * Request (or refresh) the consent URL for a Digital Twin avatar group.
   * POST /v3/avatars/{group_id}/consent
   * Returns 400 if consent is already accepted or under review — callers should
   * catch HeyGenApiError and treat it as a twin_consent_conflict.
   */
  async requestTwinConsent(groupId: string, rerouteUrl?: string): Promise<HeyGenConsentResult> {
    const body: Record<string, unknown> = {};
    if (rerouteUrl) body.reroute_url = rerouteUrl;

    const res = await this.fetch(
      `${this.baseUrl}/v3/avatars/${encodeURIComponent(groupId)}/consent`,
      {
        method: "POST",
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const parsed = await this.parseResponse<{
      data?: {
        avatar_group?: { id?: string; consent_status?: string };
        url?: string;
      };
    }>(res, `POST /v3/avatars/${groupId}/consent`);

    const url = parsed?.data?.url;
    const consentStatus = parsed?.data?.avatar_group?.consent_status ?? "pending";
    if (!url) {
      throw new HeyGenApiError(
        res.status,
        "missing_consent_url",
        "HeyGen consent: no url in response"
      );
    }
    return { url, consentStatus };
  }

  /**
   * Get the status of an avatar group (consent polling).
   * GET /v3/avatars/{group_id}
   */
  async getAvatarGroup(groupId: string): Promise<HeyGenAvatarGroupStatus> {
    const res = await this.fetch(
      `${this.baseUrl}/v3/avatars/${encodeURIComponent(groupId)}`,
      { headers: { "X-Api-Key": this.apiKey } }
    );

    const parsed = await this.parseResponse<{
      data?: {
        consent_status?: string;
        error?: { code?: string; message?: string };
      };
    }>(res, `GET /v3/avatars/${groupId}`);

    const d = parsed?.data ?? {};
    return {
      consentStatus: d.consent_status ?? "pending",
      ...(d.error?.message ? { error: { message: d.error.message } } : {}),
    };
  }

  /**
   * Submit an Avatar V Digital Twin video generation job using HeyGen TTS.
   * Mutually exclusive with createAvatarVVideo — use when no audio_asset_id is available.
   * voice_id must be the look's default_voice_id (resolved server-side; never trust client).
   */
  async createTtsVideo(params: {
    avatarId: string;
    voiceId: string;
    script: string;
    idempotencyKey: string;
    aspectRatio: HeyGenAspectRatio;
    resolution: "1080p";
    title?: string;
    engine?: HeyGenVideoEngine;
    /** Optional advanced settings (already filtered to applicable fields). */
    settings?: AvatarVideoSettings;
  }): Promise<{ videoId: string; status: string }> {
    const HEYGEN_ENGINE: HeyGenVideoEngine = params.engine ?? "avatar_v";
    const s = params.settings;

    const body: Record<string, unknown> = {
      type: "avatar",
      avatar_id: params.avatarId,
      engine: { type: HEYGEN_ENGINE },
      voice_id: params.voiceId,
      // v3 schema: top-level `script` + `voice_id` (not input_text / nested voice).
      script: params.script,
      aspect_ratio: params.aspectRatio,
      resolution: s?.resolution ?? params.resolution,
    };
    const titleToUse = s?.title ?? params.title;
    if (titleToUse) body.title = titleToUse;
    if (s) {
      if (s.fit !== undefined) body.fit = s.fit;
      if (s.background !== undefined) body.background = s.background;
      if (s.remove_background !== undefined) body.remove_background = s.remove_background;
      if (s.motion_prompt !== undefined) body.motion_prompt = s.motion_prompt;
      if (s.expressiveness !== undefined) body.expressiveness = s.expressiveness;
      if (s.voice_settings !== undefined) body.voice_settings = s.voice_settings;
      if (s.caption !== undefined) body.caption = s.caption;
    }

    const res = await this.fetch(`${this.baseUrl}/v3/videos`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": params.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const parsed = await this.parseResponse<{ data?: { video_id?: string; status?: string } }>(
      res,
      "POST /v3/videos (avatar_v tts)"
    ).catch((err: unknown) => {
      // Diagnostics: body KEYS only, never values or the API key.
      console.warn(`[heygen] ${"POST /v3/videos (avatar_v tts)"} failed; body keys: ${Object.keys(body).sort().join(",")}`);
      throw err;
    });
    const videoId: string | undefined = parsed?.data?.video_id;
    const status: string = parsed?.data?.status ?? "pending";
    if (!videoId) {
      throw new HeyGenApiError(res.status, "missing_video_id", "HeyGen /v3/videos (tts): no video_id in response");
    }
    return { videoId, status };
  }

  /**
   * @deprecated Avatar IV photo mode removed. Kept so existing callers compile.
   * New code should use createAvatarVVideo.
   */
  async createImageVideo(params: {
    imageAssetId: string;
    audioAssetId: string;
    idempotencyKey: string;
    aspectRatio: HeyGenAspectRatio;
    resolution: "1080p";
    title?: string;
  }): Promise<{ videoId: string; status: string }> {
    const body: Record<string, unknown> = {
      type: "image",
      image: { type: "asset_id", asset_id: params.imageAssetId },
      audio_asset_id: params.audioAssetId,
      aspect_ratio: params.aspectRatio,
      resolution: params.resolution,
      fit: "cover",
    };
    if (params.title) body.title = params.title;

    const res = await this.fetch(`${this.baseUrl}/v3/videos`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": params.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const parsed = await this.parseResponse<{ data?: { video_id?: string; status?: string } }>(
      res,
      "POST /v3/videos (image)"
    ).catch((err: unknown) => {
      // Diagnostics: body KEYS only, never values or the API key.
      console.warn(`[heygen] ${"POST /v3/videos (image)"} failed; body keys: ${Object.keys(body).sort().join(",")}`);
      throw err;
    });
    const videoId: string | undefined = parsed?.data?.video_id;
    const status: string = parsed?.data?.status ?? "pending";
    if (!videoId) {
      throw new HeyGenApiError(res.status, "missing_video_id", "HeyGen /v3/videos: no video_id in response");
    }
    return { videoId, status };
  }

  // ---------------------------------------------------------------------------

  private async parseResponse<T>(res: Response, label: string): Promise<T> {
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
      await res.text().catch(() => "");
      throw new HeyGenApiError(
        429,
        "rate_limited",
        `HeyGen rate limited on ${label}`,
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined
      );
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      throw new HeyGenApiError(
        res.status,
        "api_error",
        `HeyGen ${label} ${res.status}: ${raw.slice(0, 300)}`
      );
    }

    return (await res.json().catch(() => ({}))) as T;
  }
}

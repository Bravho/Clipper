import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { buildAiVideoKey } from "@/lib/spacesKeys";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import * as crypto from "crypto";

interface KlingTaskCreateResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: string;
    task_info: { external_task_id: string };
    created_at: number;
    updated_at: number;
  };
}

interface KlingTaskStatusResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: "submitted" | "processing" | "succeed" | "failed";
    task_status_msg: string;
    task_result?: {
      videos?: Array<{ id: string; url: string; watermark_url: string; duration: string }>;
    };
    task_info: { external_task_id: string };
    final_unit_deduction: string;
    created_at: number;
    updated_at: number;
  };
}

export type KlingTaskStatus =
  | { status: "submitted" }
  | { status: "processing" }
  | { status: "succeed"; videoUrl: string }
  | { status: "failed"; reason: string };

/** Generate a short-lived HS256 JWT for Kling API authentication (native Node crypto). */
function buildKlingJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ iss: AI_CONFIG.kling.apiKey, iat: now, nbf: now, exp: now + 180 })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", AI_CONFIG.kling.apiSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

async function klingFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const jwt = buildKlingJwt();
  const res = await fetch(`${AI_CONFIG.kling.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kling API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Submit a video generation task to Kling AI.
 * @returns Kling task ID for subsequent polling.
 */
export async function createVideo(params: {
  imageUrls: string[];
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
}): Promise<string> {
  // Duration support depends on the Kling model:
  //  - kling-v1 / v1.x / v2.1 image2video: only "5" or "10" seconds.
  //  - kling-v3 / kling-v3-omni: "3" to "15" seconds (set via KLING_MODEL_NAME).
  // Prefer the per-request duration; fall back to KLING_DURATION, then 15.
  // Guard against NaN/undefined from legacy records that pre-date durationSeconds.
  const requestedDuration = Number.isFinite(params.durationSeconds)
    ? params.durationSeconds
    : (AI_CONFIG.kling.defaultDuration ?? 15);
  const modelName = AI_CONFIG.kling.modelName;
  const isV3 = (modelName ?? "").includes("v3");
  const clampedDuration = isV3
    ? Math.min(Math.max(requestedDuration, 3), 15)
    : (requestedDuration <= 7 ? 5 : 10);

  const aspectRatio = params.aspectRatio || AI_CONFIG.kling.defaultAspectRatio || "9:16";

  const body: Record<string, unknown> = {
    model_name: modelName,
    image: params.imageUrls[0],
    image_tail: params.imageUrls.length > 1 ? params.imageUrls[params.imageUrls.length - 1] : undefined,
    prompt: params.prompt,
    duration: String(clampedDuration),
    aspect_ratio: aspectRatio,
    mode: AI_CONFIG.kling.mode,
  };

  // The following fields are only sent for kling-v3 / kling-v3-omni, which
  // is the first generation to expose native audio + watermark controls on
  // image2video. Sending them to v1/v2 models can trigger "invalid parameter"
  // errors, so they're gated on isV3.
  if (isV3) {
    if (AI_CONFIG.kling.sound) {
      // KLING_SOUND=on|off -> generate_audio: true|false
      body.generate_audio = AI_CONFIG.kling.sound.toLowerCase() === "on";
    }
    // NOTE: keep_original_sound / watermark are not confirmed as documented
    // Kling image2video fields as of this writing. Passed through best-effort;
    // remove if Kling responds with an "invalid parameter" error for these keys.
    body.keep_original_sound = AI_CONFIG.kling.keepOriginalSound;
    body.watermark = AI_CONFIG.kling.watermark;
  }

  console.log("=================================");
  console.log("KLING_BASE_URL =", AI_CONFIG.kling.baseUrl);
  console.log("KLING_MODEL_NAME =", modelName);
  console.log("KLING_MODE =", AI_CONFIG.kling.mode);
  console.log("KLING_DURATION =", clampedDuration);
  console.log("KLING_REQUEST =", JSON.stringify(body, null, 2));
  console.log("=================================");
  
  const response = await klingFetch<KlingTaskCreateResponse>(
    "/v1/videos/image2video",
    { method: "POST", body: JSON.stringify(body) }
  );

  if (response.code !== 0) {
    throw new Error(`Kling task creation failed: ${response.message}`);
  }
  return response.data.task_id;
}

/** Poll the status of a Kling video generation task. */
export async function pollTaskStatus(taskId: string): Promise<KlingTaskStatus> {
  const response = await klingFetch<KlingTaskStatusResponse>(
    `/v1/videos/image2video/${taskId}`
  );

  const { task_status, task_result } = response.data;

  if (task_status === "succeed") {
    const videoUrl = task_result?.videos?.[0]?.url;
    if (!videoUrl) throw new Error("Kling task succeeded but no video URL returned");
    return { status: "succeed", videoUrl };
  }
  if (task_status === "failed") {
    return { status: "failed", reason: response.data.task_status_msg || response.message || "Unknown Kling error" };
  }
  if (task_status === "submitted") return { status: "submitted" };
  return { status: "processing" };
}

/**
 * Download the completed Kling video and upload it to DigitalOcean Spaces.
 * @returns The DO Spaces storage key.
 */
export async function downloadAndStore(
  videoUrl: string,
  userId: string,
  requestId: string
): Promise<{ storageKey: string; storageUrl: string; fileSizeBytes: number }> {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Failed to download Kling video: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const storageKey = buildAiVideoKey(userId, requestId);
  const bucket = process.env.DO_SPACES_BUCKET!;

  await spacesClient.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: "video/mp4",
      ACL: "public-read",
    })
  );

  return { storageKey, storageUrl: spacesPublicUrl(storageKey), fileSizeBytes: buffer.length };
}

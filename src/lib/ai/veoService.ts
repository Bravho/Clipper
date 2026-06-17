import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { buildAiVideoKey } from "@/lib/spacesKeys";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { GoogleGenAI } from "@google/genai";

/**
 * Google Veo 3.1 Lite image-to-video service.
 *
 * Exposes a provider-neutral `createVideo` / `pollTaskStatus` /
 * `downloadAndStore` contract so `VideoGenerationService` can issue one
 * generation per approved scene and concatenate the results, without knowing
 * which provider is behind it.
 *
 * Veo is an async, long-running-operation API: `generateVideos` returns an
 * operation immediately; we persist its `name` as the "task ID" and poll it
 * via `getVideosOperation` until `done`. The finished video lives on Google's
 * Files endpoint for ~2 days and is downloaded with the API key, then mirrored
 * into DO Spaces (our durable store).
 */

export type VeoTaskStatus =
  | { status: "submitted" }
  | { status: "processing" }
  | { status: "succeed"; videoUrl: string }
  | { status: "failed"; reason: string };

/** Veo 3.1 Lite only accepts 4, 6 or 8 second clips. */
const VEO_ALLOWED_DURATIONS = [4, 6, 8] as const;

function nearestVeoDuration(requested: number): number {
  const fallback = AI_CONFIG.veo.defaultDuration;
  const value = Number.isFinite(requested) && requested > 0 ? requested : fallback;
  return VEO_ALLOWED_DURATIONS.reduce((best, d) =>
    Math.abs(d - value) < Math.abs(best - value) ? d : best
  );
}

/**
 * Veo supports only "16:9" and "9:16". Map any requested ratio onto one of
 * those: landscape (w > h) → "16:9", everything else (portrait / square) →
 * "9:16". The final per-platform crops are produced later by ffmpeg, so this
 * only sets the source generation canvas.
 */
function toVeoAspectRatio(aspectRatio: string | undefined): "16:9" | "9:16" {
  if (aspectRatio === "16:9" || aspectRatio === "9:16") return aspectRatio;
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(aspectRatio ?? "");
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w > h) return "16:9";
  }
  return AI_CONFIG.veo.defaultAspectRatio === "16:9" ? "16:9" : "9:16";
}

function getClient(): GoogleGenAI {
  const apiKey = AI_CONFIG.veo.apiKey;
  if (!apiKey) {
    throw new Error(
      "Veo API key is not set. Add VEO_API_KEY (or GEMINI_API_KEY) to .env.local and restart the dev server."
    );
  }
  return new GoogleGenAI({ apiKey });
}

/** Fetch a publicly readable image URL and return Veo inline-image data. */
async function fetchImageAsInlineData(
  url: string
): Promise<{ imageBytes: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch source image ${url}: ${res.status}`);
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType =
    contentType && contentType.startsWith("image/")
      ? contentType
      : url.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg";
  return { imageBytes: buffer.toString("base64"), mimeType };
}

/**
 * Submit one Veo 3.1 Lite image-to-video generation.
 *
 * The first selected image is the starting frame. When a scene supplies more
 * than one image, the last one is used as the interpolation `lastFrame`.
 * Returns the Veo operation name, used as the task ID for subsequent polling.
 */
export async function createVideo(params: {
  imageUrls: string[];
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
}): Promise<string> {
  if (!params.imageUrls || params.imageUrls.length === 0) {
    throw new Error("Veo createVideo: at least one source image is required");
  }

  const ai = getClient();
  const model = AI_CONFIG.veo.modelName;
  const duration = nearestVeoDuration(params.durationSeconds);
  const aspectRatio = toVeoAspectRatio(params.aspectRatio);

  const image = await fetchImageAsInlineData(params.imageUrls[0]);
  const lastFrame =
    params.imageUrls.length > 1
      ? await fetchImageAsInlineData(params.imageUrls[params.imageUrls.length - 1])
      : undefined;

  const config: Record<string, unknown> = {
    aspectRatio,
    durationSeconds: duration,
    numberOfVideos: 1,
    resolution: AI_CONFIG.veo.resolution,
    // Image-to-video only supports "allow_adult".
    personGeneration: "allow_adult",
  };
  if (lastFrame) config.lastFrame = lastFrame;
  if (AI_CONFIG.veo.negativePrompt) config.negativePrompt = AI_CONFIG.veo.negativePrompt;

  console.log("=================================");
  console.log("VEO_MODEL_NAME =", model);
  console.log("VEO_ASPECT_RATIO =", aspectRatio);
  console.log("VEO_DURATION =", duration);
  console.log("VEO_RESOLUTION =", AI_CONFIG.veo.resolution);
  console.log("VEO_IMAGES =", params.imageUrls.length, "(lastFrame:", !!lastFrame, ")");
  console.log("=================================");

  const operation = await ai.models.generateVideos({
    model,
    prompt: params.prompt,
    image,
    config,
  } as Parameters<typeof ai.models.generateVideos>[0]);

  const name = (operation as { name?: string }).name;
  if (!name) {
    throw new Error("Veo generateVideos returned an operation without a name");
  }
  return name;
}

/** Poll a Veo generation operation by its operation name. */
export async function pollTaskStatus(taskId: string): Promise<VeoTaskStatus> {
  const ai = getClient();

  const operation = await ai.operations.getVideosOperation({
    // The SDK only needs the operation name to build the GET request.
    operation: { name: taskId } as Parameters<
      typeof ai.operations.getVideosOperation
    >[0]["operation"],
  });

  if (!operation.done) return { status: "processing" };

  const error = (operation as { error?: { message?: string } }).error;
  if (error) {
    return { status: "failed", reason: error.message ?? "Unknown Veo error" };
  }

  const video = operation.response?.generatedVideos?.[0]?.video as
    | { uri?: string }
    | undefined;
  const uri = video?.uri;
  if (!uri) {
    return { status: "failed", reason: "Veo operation completed but returned no video URI" };
  }
  return { status: "succeed", videoUrl: uri };
}

/**
 * Download the completed Veo video (authenticated with the API key) and upload
 * it to DigitalOcean Spaces.
 * @returns The DO Spaces storage key, public URL and byte size.
 */
export async function downloadAndStore(
  videoUrl: string,
  userId: string,
  requestId: string
): Promise<{ storageKey: string; storageUrl: string; fileSizeBytes: number }> {
  // Veo's file URI is served from the generativelanguage Files endpoint and
  // requires the API key. Pass it as a header and ensure the media alias.
  const downloadUrl = videoUrl.includes("alt=media")
    ? videoUrl
    : `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}alt=media`;

  const res = await fetch(downloadUrl, {
    headers: { "x-goog-api-key": AI_CONFIG.veo.apiKey },
  });
  if (!res.ok) throw new Error(`Failed to download Veo video: ${res.status}`);
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

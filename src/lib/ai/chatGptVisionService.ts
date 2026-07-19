import { GoogleGenAI } from "@google/genai";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient } from "@/lib/spaces";
import { Platform } from "@/domain/enums/Platform";
import { ScenePlan, StoryboardScene } from "@/domain/models/VideoGenerationJob";
import { sanitizeThaiVoiceScript } from "@/lib/ai/thaiScriptSanitizer";
import { sanitizeScenePlanDescriptions } from "@/lib/ai/scenePlanSanitizer";
import { sanitizeStoryboard } from "@/lib/ai/storyboard";
import { extractVideoFrames } from "@/lib/ai/videoFrames";
import type { AppLocale } from "@/i18n/config";

export interface ChatGptContentOutput {
  scenePlan: ScenePlan[];
  scriptThai: string;
  hookThai: string;
  captionThai: string;
  theme: string;
  businessProfile?: {
    businessName: string;
    category: string;
    location: string | null;
    description: string | null;
    menuDetails: string | null;
  };
}

export interface SpeakingScriptOutput {
  scriptThai: string;
  captionThai: string;
  theme: string;
  /** Rough Stage-1 storyboard (sanitized; always present, fallback if needed). */
  storyboard: StoryboardScene[];
  businessProfile?: ChatGptContentOutput["businessProfile"];
}

export interface SceneDesignOutput {
  scenePlan: ScenePlan[];
  hookThai: string;
  captionThai: string;
  theme: string;
}

export interface GenerateContentParams {
  imageUrls: string[];
  /** Exact requester-entered place/business name. Never rewrite or split it. */
  placeName?: string;
  /** UI-selected content language captured when the request was created. */
  contentLanguage?: AppLocale;
  /** Requester-provided clip title (ชื่อคลิป). May contain the place/shop name. */
  title?: string;
  description: string;
  targetAudience: string;
  targetPlatforms: Platform[];
  preferredStyle: string;
  videoDurationSeconds?: number;
  businessProfileContext?: {
    businessName: string;
    category: string;
    location: string | null;
    description: string | null;
    menuDetails: string | null;
  } | null;
}

const SYSTEM_PROMPT = `You are an expert social media video producer specialising in short-form viral content for Thai audiences.

Your task is to analyse uploaded images and a brief description, then produce a complete production plan for a 15-second short video entirely in Thai.

Requirements:
- Script structure: [3s hook] + [10s main content] + [2s call-to-action]
- The first 3 seconds (hook) draw attention from the viewer from scrolling to show what is the best value this content to provide to benefit the viewer. Use the most surprising, emotionally engaging, or curiosity-inducing element available.
- All output (script, hook, scene descriptions, caption) must be in Thai only.
- Thai script: natural spoken Thai, ~40-50 words, fits comfortably within 15 seconds.
- TTS-safe text only: the script must use clear, standard Thai words and spelling suitable for AI text-to-speech (voice generation). Avoid English loanwords, abbreviations, slang, ambiguous spellings, numerals/symbols, and uncommon words that an AI voice could mispronounce — write numbers and units out as Thai words and prefer common vocabulary with unambiguous pronunciation.
- Caption: platform post caption with hashtags in Thai.
- Scene plan: break the video into ~3 scenes whose total duration equals 15 seconds.
- Scene descriptions must never mention image file names, original upload names, URLs, cloud storage keys, or image indexes such as "image 1". Refer only to visible characteristics, objects, colors, layout, mood, framing, and motion.
- Scene descriptions must not ask the video generator to render any text in the video. Do not include captions, subtitles, title cards, labels, typography, price text, CTA text, hashtags, logos-as-text, or on-screen words. Text overlays are handled in a later pipeline step.
- Veo morphing rule: only use more than one imageIndex for a scene when the scene is an image-to-image morph/interpolation. Such a scene MUST have durationSeconds exactly 8, and its visualDescriptionThai MUST begin with "Morphing scene (8 seconds): ". Single-image scenes may use other durations.
- Scene descriptions: detailed Thai description of the visuals — include all necessary direction within the description itself.
- Target audience is provided for THEME and STYLE reference only. Do NOT mention, address, or reference the target audience in the script, hook, caption, scene descriptions, or any spoken or visible content. Use it solely to inform visual tone, energy level, and creative direction.
- CRITICAL — product accuracy: Only reference, describe, or feature products, items, and details that are visibly present in the uploaded images. Do NOT invent, assume, or include any product, feature, colour, brand, or claim that cannot be directly verified from the provided images. Scripts and scene descriptions that mention unverifiable products will be rejected.
- Business profile extraction: Extract the business details from the description and images to populate the "businessProfile" field (name of the shop/restaurant, category like "ร้านอาหาร" or "คาเฟ่" or "สปา" or "โรงแรม", location if mentioned, brief shop summary, and menu/highlight items).

Respond with ONLY a valid JSON object. No markdown fences, no explanation outside the JSON.

Schema:
{
  "scenePlan": [
    {
      "sceneNumber": 1,
      "durationSeconds": 5,
      "visualDescriptionThai": "string (Thai)",
      "imageIndexes": [0]
    }
  ],
  "scriptThai": "string",
  "hookThai": "string",
  "captionThai": "string",
  "theme": "string",
  "businessProfile": {
    "businessName": "string",
    "category": "string",
    "location": "string or null",
    "description": "string or null",
    "menuDetails": "string or null"
  }
}`;

const SCRIPT_ONLY_SYSTEM_PROMPT = `You are an expert Thai short-form video script writer.

Your task is to review the requester brief, uploaded images, target platforms, preferred style, and business profile context, then write ONLY the spoken Thai script for AI voice generation.

Requirements:
- Script structure: [3s hook] + [10s main content] + [2s call-to-action].
- Thai script: natural spoken Thai, about 40-50 words, fits comfortably within 15 seconds.
- TTS-safe text only: use clear standard Thai words and spelling suitable for AI text-to-speech. Avoid English loanwords, abbreviations, slang, ambiguous spellings, numerals/symbols, and uncommon words that an AI voice could mispronounce. Write numbers and units as Thai words.
- Natural, non-forceful tone (IMPORTANT for the voice-over): write the way a friendly local person actually speaks — warm, relaxed, sincere, and conversational. Do NOT use hard-sell or over-convincing advertising language, hype words, exaggerated superlatives ("ที่สุด", "ดีที่สุดในโลก", "ห้ามพลาด"), or pushy, insistent, commanding phrasing. Over-convincing, salesy wording makes the AI voice sound unnatural and forceful. Let the food and the place speak for themselves, and keep the call-to-action a soft, gentle invitation rather than a forceful command.
- Place name (IMPORTANT): If the requester provided a specific place, shop, restaurant, cafe, or venue name in the clip title (ชื่อคลิป) or clip description (รายละเอียดคลิป), you MUST naturally include that place name in the spoken script — for example in the hook or the call-to-action — so the voice-over actually says the name. Keep it natural, and make sure it stays TTS-safe (spell it in clear Thai). If no place name was provided by the requester, do NOT invent one.
- Target audience is for theme/style reference only. Do NOT mention, address, or reference the target audience in the spoken script.
- Product accuracy: only reference products, items, and details that are visibly present in the uploaded images or clearly provided by the requester.
- Do NOT create the final scene plan, hook field, or detailed visual design in this step (that happens later).
- Also produce a ROUGH STORYBOARD: a sequence of scenes, each with a short one-line Thai summary and the zero-based indexes of the uploaded images/clips that scene will draw from. This is a rough visual outline for the requester to approve alongside the script — no motion, timing, or detailed direction yet.
- IMPORTANT: every uploaded image/clip (indexes 0 to N-1, where N is the number of uploaded files) MUST appear in at least one scene's "assetIndexes". Do not leave any uploaded file unused. Create as many scenes as needed (typically around 3, but more if there are many files) so that all uploaded media is covered. Use only valid indexes in range 0 to N-1.
- Extract business details into businessProfile when possible.

Respond with ONLY a valid JSON object. No markdown fences, no explanation outside the JSON.

Schema:
{
  "scriptThai": "string",
  "captionThai": "string",
  "theme": "string",
  "storyboard": [
    { "sceneNumber": 1, "summary": "string (Thai, one line)", "assetIndexes": [0] }
  ],
  "businessProfile": {
    "businessName": "string",
    "category": "string",
    "location": "string or null",
    "description": "string or null",
    "menuDetails": "string or null"
  }
}`;

const SCENE_DESIGN_SYSTEM_PROMPT = `You are an expert social media video director for Thai short-form ads.

Your task is to design the scenes, hook, and caption AFTER the speaking script has already been approved and converted into an AI voice. Use the approved speaking script as the creative source of truth, together with the requester brief, uploaded images, target platforms, preferred style, business profile context, and voice duration.

Requirements:
- All output must be in Thai only.
- Do NOT rewrite the speaking script.
- Create a strong hookThai that matches the approved script and captures attention in the first three seconds.
- Scene plan: about three scenes whose total duration equals the provided duration.
- Scene descriptions must never mention image file names, original upload names, URLs, cloud storage keys, or image indexes such as "image 1". Refer only to visible characteristics, objects, colors, layout, mood, framing, and motion.
- Scene descriptions must not ask the video generator to render any text in the video. Do not include captions, subtitles, title cards, labels, typography, price text, CTA text, hashtags, logos-as-text, or on-screen words. Text overlays are handled in a later pipeline step.
- Veo morphing rule: only use more than one imageIndex for a scene when the scene is an image-to-image morph/interpolation. Such a scene MUST have durationSeconds exactly 8, and its visualDescriptionThai MUST begin with "Morphing scene (8 seconds): ". Single-image scenes may use other durations.
- Scene descriptions: detailed Thai visual direction. Include motion, framing, and product focus where helpful.
- Use imageIndexes to point to relevant uploaded images by zero-based index.
- Target audience is provided for theme/style reference only. Do NOT mention, address, or reference the target audience in visible or spoken content.
- Product accuracy: Only feature products, items, and details that are visibly present in uploaded images or clearly provided by the requester. Do NOT invent final product visuals, colours, offers, brands, or claims.
- Caption: platform post caption with Thai hashtags.

Respond with ONLY a valid JSON object. No markdown fences, no explanation outside the JSON.

Schema:
{
  "scenePlan": [
    {
      "sceneNumber": 1,
      "durationSeconds": 5,
      "visualDescriptionThai": "string (Thai)",
      "imageIndexes": [0]
    }
  ],
  "hookThai": "string",
  "captionThai": "string",
  "theme": "string"
}`;

function buildUserPrompt(params: GenerateContentParams): string {
  const outputLanguage =
    params.contentLanguage === "en"
      ? "English"
      : params.contentLanguage === "vi"
        ? "Vietnamese"
        : "Thai";
  const promptParts = [
    `Selected content language: ${outputLanguage}. All requester-visible generated prose, speaking script, captions, hooks, storyboard summaries, and scene descriptions MUST be written in ${outputLanguage}. Preserve user-provided names exactly in their original spelling.`,
    ...(params.title && params.title.trim()
      ? [
          `Clip title (ชื่อคลิป, provided by the requester — may contain the place/shop/venue name to say in the script): ${params.title}`,
        ]
      : []),
    ...(params.placeName?.trim()
      ? [
          `AUTHORITATIVE place/business name: "${params.placeName.trim()}"`,
          `Place-name preservation rule: reproduce "${params.placeName.trim()}" exactly in visible text. Do not translate, rewrite, abbreviate, normalize, or split this name across sentences or subtitle phrases.`,
        ]
      : []),
    `Video description (รายละเอียดคลิป, provided by the requester — may contain the place/shop/venue name to say in the script): ${params.description}`,
    `Target audience (for theme/style reference only — do not include in script or scene content): ${params.targetAudience}`,
    `Target platforms: ${params.targetPlatforms.join(", ")}`,
    `Preferred style/tone: ${params.preferredStyle}`,
    `Duration: ${params.videoDurationSeconds ?? 15} seconds`,
    `Number of uploaded assets (images and/or video clips): ${params.imageUrls.length}`,
    `Asset indexing: each uploaded asset is provided above, preceded by a text label "Uploaded asset index N" giving its zero-based index. Use exactly these labels as the indexes for imageIndexes / assetIndexes. A video clip may be shown as SEVERAL sampled frames under a single "Uploaded asset index N" label — treat all of those frames as the SAME asset index N (one asset), not as multiple assets.`,
  ];

  if (params.businessProfileContext) {
    const bp = params.businessProfileContext;
    promptParts.push(
      `Business Profile Context (stored profile details of this shop for your creative reference):`,
      `- Business Name: ${bp.businessName}`,
      `- Category: ${bp.category}`,
      `- Location: ${bp.location ?? "N/A"}`,
      `- Shop Description: ${bp.description ?? "N/A"}`,
      `- Key Menu/Products: ${bp.menuDetails ?? "N/A"}`
    );
  }

  promptParts.push(
    "Use the information above and the uploaded images as source material. Follow the JSON schema from the system instructions."
  );

  return promptParts.join("\n");
}

function buildSceneDesignPrompt(
  params: GenerateContentParams & {
    scriptThai: string;
    voiceDurationSeconds?: number | null;
    storyboard?: StoryboardScene[] | null;
  }
): string {
  const lines = [
    buildUserPrompt(params),
    "",
    `Approved speaking script: ${params.scriptThai}`,
    `Generated voice duration: ${params.voiceDurationSeconds ?? params.videoDurationSeconds ?? 15} seconds`,
  ];

  if (params.storyboard && params.storyboard.length > 0) {
    lines.push(
      "",
      "Approved storyboard (use as the seed — keep the scene order and image selection unless the script clearly needs otherwise):",
      ...params.storyboard.map(
        (s) =>
          `  Scene ${s.sceneNumber}: ${s.summary || "(no summary)"} — images [${s.assetIndexes.join(", ")}]`
      )
    );
  }

  lines.push(
    "Design scenes, hook, and caption from the approved speaking script, approved storyboard, and requester-provided information."
  );
  return lines.join("\n");
}

/**
 * Extract the DO Spaces storage key from a public or CDN URL.
 * Handles both path-style (endpoint/bucket/key) and CDN (cdn-endpoint/key).
 */
function extractStorageKey(url: string): string {
  const bucket = process.env.DO_SPACES_BUCKET ?? "";
  const cdnEndpoint = process.env.DO_SPACES_CDN_ENDPOINT;
  if (cdnEndpoint && url.startsWith(cdnEndpoint)) {
    return url.slice(cdnEndpoint.length).replace(/^\//, "");
  }
  // Path-style URL: https://endpoint/bucket/key
  const parts = url.split(`/${bucket}/`);
  if (parts.length >= 2) return parts.slice(1).join(`/${bucket}/`);
  // Fallback: everything after the third slash segment
  return url.replace(/^https?:\/\/[^/]+\//, "");
}

/**
 * Download an object from DO Spaces using the authenticated S3 client
 * (avoids 403 errors on non-public objects). Returns the raw bytes plus the
 * stored content type so callers can tell images from video clips.
 */
async function downloadObjectBuffer(
  url: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const key = extractStorageKey(url);
  const bucket = process.env.DO_SPACES_BUCKET!;
  const res = await spacesClient.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return {
    buffer: Buffer.concat(chunks),
    mimeType: res.ContentType ?? "image/jpeg",
  };
}

export async function generateScenePlanAndScript(
  params: GenerateContentParams
): Promise<ChatGptContentOutput> {
  const output = await generateWithImages<ChatGptContentOutput>(
    params,
    `${SYSTEM_PROMPT}\n\n${buildUserPrompt(params)}`
  );
  return {
    ...output,
    scenePlan: sanitizeScenePlanDescriptions(output.scenePlan),
    scriptThai: sanitizeThaiVoiceScript(output.scriptThai),
    hookThai: sanitizeThaiVoiceScript(output.hookThai),
  };
}

async function generateWithImages<T>(params: GenerateContentParams, prompt: string): Promise<T> {
  const ai = new GoogleGenAI({ apiKey: AI_CONFIG.gemini.apiKey });

  // Build the multimodal request. `params.imageUrls` is in canonical asset
  // order, so its position IS the zero-based asset index the model must use for
  // imageIndexes/assetIndexes. Each asset is preceded by an explicit index
  // label so the mapping survives even when a video clip contributes several
  // sampled frames (i.e. more image parts than assets).
  const contents: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

  for (let index = 0; index < params.imageUrls.length; index++) {
    const url = params.imageUrls[index];
    const { buffer, mimeType } = await downloadObjectBuffer(url);

    if (mimeType.startsWith("video/")) {
      // Send a few sampled frames instead of the whole clip (cheaper + avoids
      // Gemini's inline size limit). Fall back to the raw clip only if frame
      // extraction is unavailable, preserving the old behaviour in that case.
      const frames = await extractVideoFrames(buffer);
      contents.push({
        text: `Uploaded asset index ${index} (video clip — ${
          frames.length > 0 ? `${frames.length} sampled frame(s) of the same clip` : "clip"
        }):`,
      });
      if (frames.length > 0) {
        for (const f of frames) contents.push({ inlineData: { data: f.data, mimeType: f.mimeType } });
      } else {
        contents.push({ inlineData: { data: buffer.toString("base64"), mimeType } });
      }
    } else {
      contents.push({ text: `Uploaded asset index ${index} (image):` });
      contents.push({ inlineData: { data: buffer.toString("base64"), mimeType } });
    }
  }

  contents.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: AI_CONFIG.gemini.visionModel,
    contents,
    config: {
      responseMimeType: "application/json",
      temperature: 0.7,
    },
  });

  const raw = response.text ?? "";
  if (!raw) throw new Error("Gemini returned an empty response");

  return JSON.parse(raw) as T;
}

export async function generateSpeakingScript(
  params: GenerateContentParams
): Promise<SpeakingScriptOutput> {
  const output = await generateWithImages<SpeakingScriptOutput & { storyboard?: unknown }>(
    params,
    `${SCRIPT_ONLY_SYSTEM_PROMPT}\n\n${buildUserPrompt(params)}`
  );
  return {
    ...output,
    scriptThai: sanitizeThaiVoiceScript(output.scriptThai),
    // Always return a usable storyboard — repair the model output or fall back.
    storyboard: sanitizeStoryboard(output.storyboard, params.imageUrls.length),
  };
}

export async function generateSceneDesignFromScript(
  params: GenerateContentParams & {
    scriptThai: string;
    voiceDurationSeconds?: number | null;
    storyboard?: StoryboardScene[] | null;
  }
): Promise<SceneDesignOutput> {
  const output = await generateWithImages<SceneDesignOutput>(
    params,
    `${SCENE_DESIGN_SYSTEM_PROMPT}\n\n${buildSceneDesignPrompt(params)}`
  );
  return {
    ...output,
    scenePlan: sanitizeScenePlanDescriptions(output.scenePlan),
  };
}

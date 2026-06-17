import { GoogleGenAI } from "@google/genai";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient } from "@/lib/spaces";
import { Platform } from "@/domain/enums/Platform";
import { ScenePlan } from "@/domain/models/VideoGenerationJob";
import { sanitizeThaiVoiceScript } from "@/lib/ai/thaiScriptSanitizer";

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
- Target audience is for theme/style reference only. Do NOT mention, address, or reference the target audience in the spoken script.
- Product accuracy: only reference products, items, and details that are visibly present in the uploaded images or clearly provided by the requester.
- Do NOT create a scene plan, hook field, or visual design in this step.
- Extract business details into businessProfile when possible.

Respond with ONLY a valid JSON object. No markdown fences, no explanation outside the JSON.

Schema:
{
  "scriptThai": "string",
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

const SCENE_DESIGN_SYSTEM_PROMPT = `You are an expert social media video director for Thai short-form ads.

Your task is to design the scenes, hook, and caption AFTER the speaking script has already been approved and converted into an AI voice. Use the approved speaking script as the creative source of truth, together with the requester brief, uploaded images, target platforms, preferred style, business profile context, and voice duration.

Requirements:
- All output must be in Thai only.
- Do NOT rewrite the speaking script.
- Create a strong hookThai that matches the approved script and captures attention in the first three seconds.
- Scene plan: about three scenes whose total duration equals the provided duration.
- Scene descriptions: detailed Thai visual direction. Include motion, framing, product focus, and on-screen emphasis where helpful.
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
  const promptParts = [
    `Video description: ${params.description}`,
    `Target audience (for theme/style reference only — do not include in script or scene content): ${params.targetAudience}`,
    `Target platforms: ${params.targetPlatforms.join(", ")}`,
    `Preferred style/tone: ${params.preferredStyle}`,
    `Duration: ${params.videoDurationSeconds ?? 15} seconds`,
    `Number of uploaded images: ${params.imageUrls.length}`,
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
  params: GenerateContentParams & { scriptThai: string; voiceDurationSeconds?: number | null }
): string {
  return [
    buildUserPrompt(params),
    "",
    `Approved speaking script: ${params.scriptThai}`,
    `Generated voice duration: ${params.voiceDurationSeconds ?? params.videoDurationSeconds ?? 15} seconds`,
    "Design scenes, hook, and caption from the approved speaking script and requester-provided information.",
  ].join("\n");
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
 * Download an image from DO Spaces using the authenticated S3 client
 * (avoids 403 errors on non-public objects).
 */
async function downloadImageAsBase64(
  url: string
): Promise<{ data: string; mimeType: string }> {
  const key = extractStorageKey(url);
  const bucket = process.env.DO_SPACES_BUCKET!;
  const res = await spacesClient.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return {
    data: buffer.toString("base64"),
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
    scriptThai: sanitizeThaiVoiceScript(output.scriptThai),
    hookThai: sanitizeThaiVoiceScript(output.hookThai),
  };
}

async function generateWithImages<T>(params: GenerateContentParams, prompt: string): Promise<T> {
  const ai = new GoogleGenAI({ apiKey: AI_CONFIG.gemini.apiKey });

  // Download all images and encode as base64 inline parts
  const imageParts = await Promise.all(
    params.imageUrls.map(async (url) => {
      const { data, mimeType } = await downloadImageAsBase64(url);
      return { inlineData: { data, mimeType } };
    })
  );

  const contents = [
    ...imageParts,
    { text: prompt },
  ];

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
  const output = await generateWithImages<SpeakingScriptOutput>(
    params,
    `${SCRIPT_ONLY_SYSTEM_PROMPT}\n\n${buildUserPrompt(params)}`
  );
  return {
    ...output,
    scriptThai: sanitizeThaiVoiceScript(output.scriptThai),
  };
}

export async function generateSceneDesignFromScript(
  params: GenerateContentParams & { scriptThai: string; voiceDurationSeconds?: number | null }
): Promise<SceneDesignOutput> {
  return generateWithImages<SceneDesignOutput>(
    params,
    `${SCENE_DESIGN_SYSTEM_PROMPT}\n\n${buildSceneDesignPrompt(params)}`
  );
}

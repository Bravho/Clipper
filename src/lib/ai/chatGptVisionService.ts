import { GoogleGenAI } from "@google/genai";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient } from "@/lib/spaces";
import { Platform } from "@/domain/enums/Platform";
import { ScenePlan, StoryboardScene } from "@/domain/models/VideoGenerationJob";
import { sanitizeThaiVoiceScript } from "@/lib/ai/thaiScriptSanitizer";
import { sanitizeScenePlanDescriptions } from "@/lib/ai/scenePlanSanitizer";
import { sanitizeStoryboard } from "@/lib/ai/storyboard";
import {
  countScriptUnits,
  maxScriptUnits,
  SCRIPT_UNITS_PER_SECOND,
  scriptLanguageOf,
  unitsForVoiceSeconds,
  scriptUnitName,
  trimScriptToFit,
  type ScriptLanguage,
} from "@/lib/ai/scriptLength";
import { extractVideoFrames } from "@/lib/ai/videoFrames";
import type { AppLocale } from "@/i18n/config";
import type { LocalAnalysisFrame } from "@/lib/mobile/localMediaContract";

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
  /** Transient phone-generated frames. Never persisted by the server. */
  inlineFrames?: LocalAnalysisFrame[];
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
- Fit the script comfortably within the requested Duration in the user prompt. Reserve roughly 20% for the hook and 15% for a gentle call-to-action; use the remainder for the main content.
- LENGTH IS A HARD LIMIT: the user prompt gives a "HARD LENGTH LIMIT" for the script. The script MUST stay within it — the voice made from it has to finish before the picked scenes end. Write short, simple sentences. When in doubt, cut a sentence; a script that is too short is fine, one that is too long is not.
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
      "Approved storyboard (AUTHORITATIVE: preserve its exact scene order and per-scene asset selection; only refine visual direction and timing):",
      ...params.storyboard.map(
        (s) =>
          `  Scene ${s.sceneNumber}: ${s.summary || "(no summary)"} — images [${s.assetIndexes.join(", ")}]`
      )
    );
  }

  lines.push(
    "Design scenes, hook, and caption from the approved speaking script, approved storyboard, and requester-provided information. Never move, add, remove, or substitute the storyboard's selected assets."
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

  if (params.inlineFrames?.length) {
    const byIndex = new Map<number, LocalAnalysisFrame[]>();
    for (const frame of params.inlineFrames) {
      const frames = byIndex.get(frame.assetIndex) ?? [];
      frames.push(frame);
      byIndex.set(frame.assetIndex, frames);
    }
    for (let index = 0; index < params.imageUrls.length; index++) {
      const frames = byIndex.get(index) ?? [];
      if (frames.length === 0) continue;
      contents.push({
        text: `Device-local asset index ${index} (${frames.length} derived analysis frame(s); original remains on the phone):`,
      });
      for (const frame of frames) {
        contents.push({
          inlineData: { data: frame.dataBase64, mimeType: frame.mimeType },
        });
      }
    }
  } else for (let index = 0; index < params.imageUrls.length; index++) {
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
  const seconds = params.videoDurationSeconds ?? 15;
  const language = scriptLanguageOf(params.contentLanguage);
  const maxUnits = maxScriptUnits(seconds, language);
  const lengthRule = [
    `HARD LENGTH LIMIT for "scriptThai": at most ${maxUnits} ${scriptUnitName(language)} in total.`,
    `That is what an AI voice can say in about ${Math.round(seconds)} seconds, the length of the picked scenes. Aim for about ${Math.floor(maxUnits * 0.85)}; never exceed ${maxUnits}.`,
  ].join("\n");
  const output = await generateWithImages<SpeakingScriptOutput & { storyboard?: unknown }>(
    params,
    `${SCRIPT_ONLY_SYSTEM_PROMPT}\n\n${buildUserPrompt(params)}\n${lengthRule}`
  );
  const script = await fitScriptToLength(
    sanitizeThaiVoiceScript(output.scriptThai ?? ""),
    seconds,
    language
  );
  return {
    ...output,
    scriptThai: script,
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

/**
 * Hold the speaking script to its length budget (see `scriptLength.ts`): one
 * text-only "shorten it" pass when the model overshot, then — only if that is
 * still too long or fails — a trim at a sentence/phrase boundary.
 */
async function fitScriptToLength(
  script: string,
  seconds: number,
  language: ScriptLanguage
): Promise<string> {
  const max = maxScriptUnits(seconds, language);
  const count = countScriptUnits(script, language);
  if (count <= max) return script;
  console.warn(`[Script length] ${count} units > ${max} for ${seconds}s (${language}); shortening`);

  let shortened = script;
  try {
    const ai = new GoogleGenAI({ apiKey: AI_CONFIG.gemini.apiKey });
    const response = await ai.models.generateContent({
      model: AI_CONFIG.gemini.visionModel,
      contents: [
        {
          text: [
            "Shorten this voice-over script so an AI voice can say it within the time limit.",
            `HARD LIMIT: at most ${max} ${scriptUnitName(language)}; aim for about ${Math.floor(max * 0.85)}. It is currently ${count}.`,
            "Keep the same language, the opening hook, any place/shop name exactly as written, and a short gentle closing line. Remove the least important sentences and simplify the rest. Keep it natural and TTS-safe (no numerals, symbols, or abbreviations).",
            'Respond with ONLY a JSON object: {"script": "string"}',
            "",
            "Script:",
            script,
          ].join("\n"),
        },
      ],
      config: { responseMimeType: "application/json", temperature: 0.3 },
    });
    const parsed = JSON.parse(response.text ?? "{}") as { script?: unknown };
    if (typeof parsed.script === "string" && parsed.script.trim()) {
      shortened = sanitizeThaiVoiceScript(parsed.script);
    }
  } catch (err) {
    console.error("[Script length] shorten pass failed:", err);
  }
  return trimScriptToFit(shortened, seconds, language);
}

/**
 * One scene of the APPROVED storyboard, as the script writer sees it: how long
 * it holds the screen, how much of that is free for speech, and which
 * pictures it shows for how long.
 */
export interface ScriptSceneTiming {
  sceneNumber: number;
  /** The requester's one-line summary of the scene (may be empty). */
  summary: string;
  /** How long the scene holds the screen, seconds. */
  seconds: number;
  /**
   * Seconds of speech the scene can carry: its length, less the music intro
   * on the first scene and the quiet ending on the last.
   */
  speakSeconds: number;
  /** The scene's pictures in order: zero-based asset index, kind, seconds on screen. */
  shots: { assetIndex: number; kind: "image" | "clip"; seconds: number }[];
}

export interface StoryboardScriptOutput {
  scriptThai: string;
  /** The line written for each scene, in scene order ("" for a silent scene). */
  sceneLines: string[];
}

const STORYBOARD_SCRIPT_SYSTEM_PROMPT = `You are an expert short-form video voice-over writer.

The requester has ALREADY arranged and approved the storyboard: the scenes, their order, the pictures in each scene, and how long each scene and picture stays on screen. Write the spoken voice-over so it matches that storyboard exactly: what is said during a scene must be about what that scene's pictures show, and each scene's line must fit inside that scene's time.

Requirements:
- Write ONE line (one or two short sentences) per scene, in scene order. The lines are read back to back as one voice-over, so they must flow naturally from one to the next.
- Each scene's line is about the pictures shown in that scene (look at the uploaded assets with those indexes). Describe what is actually visible; never describe a picture that belongs to another scene.
- PER-SCENE LENGTH: each scene has a target and a maximum in the user prompt. Write close to the TARGET — it is deliberately a little longer than the scene, so the requester can cut words they do not want rather than having to write new ones. Never exceed the maximum. A scene with a maximum of 0 gets an empty line "".
- The first scene opens with a hook that makes the viewer stop scrolling. The last scene closes with a short, gentle invitation.
- TTS-safe text only: clear standard words and spelling for AI text-to-speech. No numerals, symbols, abbreviations, slang, or loanwords an AI voice may mispronounce; write numbers and units as words.
- Natural, non-forceful tone: warm, relaxed, sincere, conversational, the way a friendly local person speaks. No hard-sell hype, exaggerated superlatives, or pushy commands.
- Place name: if the requester gave a place/shop name in the title or description, say it naturally once (in the hook or the closing). Never invent one.
- Target audience is for tone only; never mention or address it.
- Product accuracy: only mention items visibly present in the pictures or stated by the requester.

Respond with ONLY a valid JSON object. No markdown fences, no explanation outside the JSON.

Schema:
{
  "scenes": [ { "sceneNumber": 1, "line": "string" } ],
  "captionThai": "string"
}`;

/**
 * How much longer than the storyboard the script is written: a little, on
 * purpose (Tho, 2026-10-11) — trimming a script is easy on a phone, writing
 * more is not. `MAX` is the hard ceiling enforced in code.
 */
export const STORYBOARD_SCRIPT_TARGET_SHARE = 1.1;
export const STORYBOARD_SCRIPT_MAX_SHARE = 1.2;

/** Target and ceiling for one scene's line, in script units. */
export function sceneLineUnits(
  speakSeconds: number,
  language: ScriptLanguage
): { target: number; max: number } {
  if (!(speakSeconds >= 0.5)) return { target: 0, max: 0 };
  return {
    target: unitsForVoiceSeconds(speakSeconds * STORYBOARD_SCRIPT_TARGET_SHARE, language),
    max: unitsForVoiceSeconds(speakSeconds * STORYBOARD_SCRIPT_MAX_SHARE, language),
  };
}

/** `trimScriptToFit` takes seconds at the LIMIT rate; express units that way. */
function limitSecondsForUnits(units: number, language: ScriptLanguage): number {
  return units / SCRIPT_UNITS_PER_SECOND[language];
}

function buildStoryboardScriptPrompt(
  params: GenerateContentParams & { scenes: ScriptSceneTiming[] },
  language: ScriptLanguage
): string {
  const total = params.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  const speak = params.scenes.reduce((sum, scene) => sum + scene.speakSeconds, 0);
  const lines = [
    buildUserPrompt({ ...params, videoDurationSeconds: total }),
    "",
    `APPROVED STORYBOARD — ${params.scenes.length} scene(s), ${total.toFixed(1)} seconds of pictures in total, of which about ${speak.toFixed(1)} seconds can carry speech (the music intro and the quiet ending are kept free).`,
    `Lengths are counted in ${scriptUnitName(language)}.`,
  ];
  for (const scene of params.scenes) {
    const { target, max } = sceneLineUnits(scene.speakSeconds, language);
    const shots = scene.shots
      .map((shot) => `asset index ${shot.assetIndex} (${shot.kind}, ${shot.seconds.toFixed(1)} s)`)
      .join(", ");
    lines.push(
      `  Scene ${scene.sceneNumber}: ${scene.seconds.toFixed(1)} s on screen (about ${scene.speakSeconds.toFixed(1)} s of speech); line target ${target}, maximum ${max}.` +
        `${scene.summary ? ` Summary: ${scene.summary}.` : ""} Pictures in order: ${shots || "none"}.`
    );
  }
  lines.push(
    "Write each scene's line about that scene's own pictures, close to its target, so the voice follows the pictures as they change."
  );
  return lines.join("\n");
}

/**
 * Write the speaking script FROM the approved storyboard: one line per scene,
 * each about that scene's pictures and held to that scene's share of time, so
 * the voice changes subject when the picture does and the whole voice fits the
 * combined scene length.
 *
 * The limits are enforced in code as well as asked for: a scene line over its
 * budget is trimmed at a phrase boundary, and the joined script goes through
 * the same length check as every other script.
 */
export async function generateScriptForStoryboard(
  params: GenerateContentParams & { scenes: ScriptSceneTiming[] }
): Promise<StoryboardScriptOutput & { captionThai: string | null }> {
  const language = scriptLanguageOf(params.contentLanguage);
  const output = await generateWithImages<{
    scenes?: { sceneNumber?: unknown; line?: unknown }[];
    captionThai?: unknown;
  }>(params, `${STORYBOARD_SCRIPT_SYSTEM_PROMPT}\n\n${buildStoryboardScriptPrompt(params, language)}`);

  const written = Array.isArray(output.scenes) ? output.scenes : [];
  const sceneLines = params.scenes.map((scene, index) => {
    const match =
      written.find((item) => Number(item?.sceneNumber) === scene.sceneNumber) ?? written[index];
    const raw = typeof match?.line === "string" ? sanitizeThaiVoiceScript(match.line) : "";
    const { max } = sceneLineUnits(scene.speakSeconds, language);
    if (!raw || max === 0) return "";
    return trimScriptToFit(raw, limitSecondsForUnits(max, language), language);
  });

  // The whole script: at most the ceiling share of what the scenes carry.
  const speakSeconds = params.scenes.reduce((sum, scene) => sum + scene.speakSeconds, 0);
  const joined = sceneLines.filter(Boolean).join(" ");
  if (!joined) throw new Error("The script writer returned no lines for the storyboard.");
  const ceiling = unitsForVoiceSeconds(speakSeconds * STORYBOARD_SCRIPT_MAX_SHARE, language);
  const scriptThai =
    countScriptUnits(joined, language) > ceiling
      ? await shortenScriptToUnits(joined, ceiling, language)
      : joined;
  return {
    scriptThai,
    sceneLines,
    captionThai: typeof output.captionThai === "string" && output.captionThai.trim()
      ? output.captionThai.trim()
      : null,
  };
}

/**
 * Shorten a script to at most `maxUnits`: one AI pass that keeps the hook, the
 * place name and the closing line, then — only if that is still too long or
 * fails — a trim at a sentence/phrase boundary. Used when the voice came out
 * longer than the scenes can be stretched to carry.
 */
export async function shortenScriptToUnits(
  script: string,
  maxUnits: number,
  language: ScriptLanguage
): Promise<string> {
  const max = Math.max(1, Math.floor(maxUnits));
  const count = countScriptUnits(script, language);
  if (count <= max) return script;

  let shortened = script;
  try {
    const ai = new GoogleGenAI({ apiKey: AI_CONFIG.gemini.apiKey });
    const response = await ai.models.generateContent({
      model: AI_CONFIG.gemini.visionModel,
      contents: [
        {
          text: [
            "Shorten this voice-over script so an AI voice says it in less time.",
            `HARD LIMIT: at most ${max} ${scriptUnitName(language)}; aim for about ${Math.floor(max * 0.95)}. It is currently ${count}.`,
            "Keep the same language, the order of ideas (each part describes the pictures shown at that moment), the opening hook, any place/shop name exactly as written, and a short gentle closing line. Remove the least important words and phrases evenly across the script rather than cutting the end. Keep it natural and TTS-safe (no numerals, symbols, or abbreviations).",
            'Respond with ONLY a JSON object: {"script": "string"}',
            "",
            "Script:",
            script,
          ].join("\n"),
        },
      ],
      config: { responseMimeType: "application/json", temperature: 0.3 },
    });
    const parsed = JSON.parse(response.text ?? "{}") as { script?: unknown };
    if (typeof parsed.script === "string" && parsed.script.trim()) {
      shortened = sanitizeThaiVoiceScript(parsed.script);
    }
  } catch (err) {
    console.error("[Script length] shorten-to-units pass failed:", err);
  }
  return trimScriptToFit(shortened, limitSecondsForUnits(max, language), language);
}

/**
 * Split the storyboard's time into speech time per scene: the first scene
 * gives up the music intro, the last the quiet ending, and a scene shorter
 * than what it gives up carries no speech.
 */
export function speakSecondsForScenes(
  sceneSeconds: number[],
  introSeconds: number,
  endingSeconds: number
): number[] {
  const out = sceneSeconds.map((seconds) => (Number.isFinite(seconds) && seconds > 0 ? seconds : 0));
  // Take the intro from the front and the ending from the back, spilling into
  // the next scene when one is too short to absorb it.
  let intro = Math.max(0, introSeconds);
  for (let i = 0; i < out.length && intro > 0; i++) {
    const take = Math.min(out[i], intro);
    out[i] -= take;
    intro -= take;
  }
  let ending = Math.max(0, endingSeconds);
  for (let i = out.length - 1; i >= 0 && ending > 0; i--) {
    const take = Math.min(out[i], ending);
    out[i] -= take;
    ending -= take;
  }
  return out.map((seconds) => Math.round(seconds * 100) / 100);
}

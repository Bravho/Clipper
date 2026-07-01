import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { AI_CONFIG, requireGeminiApiKey } from "@/config/aiTools";
import type { TimedSegment } from "@/lib/ai/geminiSubtitlesService";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

const execAsync = promisify(exec);

export type AnimationType = "kinetic_text" | "lower_third" | "cta_banner";
export type AnimationEffect = "fade_in" | "fade_slide_up" | "slide_in_left";

export interface AnimationSpec {
  startMs: number;
  endMs: number;
  type: AnimationType;
  text: string;
  effect: AnimationEffect;
}

const ANIMATION_SYSTEM_PROMPT = `You are a senior motion-graphics designer for premium short-form food/restaurant social media promos. You design tasteful kinetic captions and on-screen graphics that reinforce the voiceover — never clutter it.

ALL overlay text you produce MUST be in ENGLISH (short, punchy English phrasing), regardless of the source language.

You are given an English script, per-sentence timestamps, the total duration, and a scene plan. Produce animated text overlay specs that sit ON TOP of footage that already has sentence subtitles, so your overlays must COMPLEMENT, not duplicate, the subtitles.

Design rules:
- Produce 3-5 overlays total across the whole video — enough to feel dynamic, never crowded. Scale the count to the duration (~1 overlay per 3-4s).
- "kinetic_text": ONE punchy hook in the opening (~first 2.5s) — large centered text, 2-4 words, drawn from the hook/first sentence. Grabs attention.
- "lower_third": the business/product name or a key selling point, shown briefly during the body. Max 4 words. Use 1-2 of these, spaced apart.
- "cta_banner": ONE closing call-to-action over the final ~2s (e.g. "สั่งเลยวันนี้", "แวะมาชิม"). Max 4 words.
- Keep every overlay SHORT (≤4 words) and high-contrast-readable. Prefer real phrases from the script over invented copy.
- Stagger timings so no two overlays of the same type overlap; align each roughly to the sentence it reinforces using the supplied timestamps.
- Timestamps are in milliseconds, strictly within [0, total duration]. Each overlay carries its own ~300ms fade in/out (start ~300ms before the cue, end ~300ms after).
- Choose an "effect" that suits the type: "fade_slide_up" for kinetic_text, "slide_in_left" for lower_third, "fade_in" for cta_banner (you may vary tastefully).

Respond ONLY with a valid JSON array of AnimationSpec objects — no markdown fences, no prose. All "text" values MUST be English.
Schema: [{ "startMs": number, "endMs": number, "type": "kinetic_text"|"lower_third"|"cta_banner", "text": "string", "effect": "fade_in"|"fade_slide_up"|"slide_in_left" }]`;

export async function generateAnimationSpec(params: {
  scriptEnglish: string;
  timedSegments: TimedSegment[];
  scenePlan: ScenePlan[];
  hookEnglish: string;
  durationSeconds: number;
}): Promise<AnimationSpec[]> {
  const { scriptEnglish, timedSegments, scenePlan, hookEnglish, durationSeconds } = params;

  // Use Gemini (not Anthropic) — the rest of the pipeline already runs on
  // Gemini, so this avoids a separate Anthropic billing/credit dependency that
  // was 400-ing ("credit balance too low") and forcing the default specs.
  let apiKey: string;
  try {
    apiKey = requireGeminiApiKey();
  } catch {
    return _defaultAnimationSpec(timedSegments, durationSeconds);
  }

  const userMessage = `English script: "${scriptEnglish}"
Hook (first 3s): "${hookEnglish}"
Total duration: ${durationSeconds}s

Voice timeline (per sentence, English):
${timedSegments.map((s) => `  [${(s.startSecond * 1000).toFixed(0)}ms–${(s.endSecond * 1000).toFixed(0)}ms] "${s.textEnglish ?? s.textThai}"`).join("\n")}

Scene plan:
${scenePlan.map((s) => `  Scene ${s.sceneNumber} (${s.durationSeconds}s): ${s.visualDescriptionThai}`).join("\n")}

Generate ENGLISH animation overlay specs in JSON.`;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: AI_CONFIG.gemini.textModel,
      contents: `${ANIMATION_SYSTEM_PROMPT}\n\n${userMessage}`,
      config: { responseMimeType: "application/json", temperature: 0.5 },
    });
    const raw = res.text ?? "";
    const specs = JSON.parse(stripJsonFences(raw)) as AnimationSpec[];
    return Array.isArray(specs) && specs.length > 0
      ? specs
      : _defaultAnimationSpec(timedSegments, durationSeconds);
  } catch (err) {
    console.error("[animationService] Gemini failed, using defaults:", err);
    return _defaultAnimationSpec(timedSegments, durationSeconds);
  }
}

/**
 * Strip a leading/trailing markdown code fence (```json … ```) before parsing,
 * sometimes adds despite the "no markdown" instruction, before JSON.parse.
 */
function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function _defaultAnimationSpec(segments: TimedSegment[], durationSeconds: number): AnimationSpec[] {
  const specs: AnimationSpec[] = [];
  const totalMs = durationSeconds * 1000;

  // English text (motion graphics are always English). Fall back to Thai only
  // if an English translation is somehow missing.
  const firstText = (segments[0]?.textEnglish ?? segments[0]?.textThai ?? "").split(" ").slice(0, 4).join(" ");
  if (segments[0] && firstText) {
    specs.push({
      startMs: Math.max(0, segments[0].startSecond * 1000 - 300),
      endMs: Math.min(totalMs, segments[0].endSecond * 1000 + 300),
      type: "kinetic_text",
      text: firstText,
      effect: "fade_slide_up",
    });
  }

  const lastSeg = segments[segments.length - 1];
  const lastText = (lastSeg?.textEnglish ?? lastSeg?.textThai ?? "").split(" ").slice(0, 4).join(" ");
  if (lastSeg && lastText) {
    specs.push({
      startMs: Math.max(0, lastSeg.startSecond * 1000 - 200),
      endMs: totalMs,
      type: "cta_banner",
      text: lastText,
      effect: "fade_in",
    });
  }

  return specs;
}

function escapeDrawtextString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
}

function buildFilterChain(specs: AnimationSpec[], videoWidth = 1080, videoHeight = 1920): string {
  if (specs.length === 0) return "";

  const filters = specs.map((spec) => {
    const startS = spec.startMs / 1000;
    const endS = spec.endMs / 1000;
    const fadeDur = 0.3;
    const text = escapeDrawtextString(spec.text);

    const alpha = `if(lt(t\\,${startS}+${fadeDur}),(t-${startS})/${fadeDur},if(gt(t\\,${endS}-${fadeDur}),(${endS}-t)/${fadeDur},1))`;
    const enable = `between(t\\,${startS}\\,${endS})`;

    let x: string;
    let y: string;
    let fontsize: number;
    let color: string;

    switch (spec.type) {
      case "kinetic_text":
        fontsize = 72;
        color = "white";
        x = `(w-text_w)/2`;
        y = spec.effect === "fade_slide_up"
          ? `(h-text_h)/2+if(lt(t\\,${startS}+${fadeDur}),(1-(t-${startS})/${fadeDur})*60\\,0)`
          : `(h-text_h)/2`;
        break;
      case "lower_third":
        fontsize = 52;
        color = "white";
        x = spec.effect === "slide_in_left"
          ? `if(lt(t\\,${startS}+${fadeDur}),(1-(t-${startS})/${fadeDur})*(-text_w)+80\\,80)`
          : `80`;
        y = `h-text_h-160`;
        break;
      case "cta_banner":
        fontsize = 58;
        color = "yellow";
        x = `(w-text_w)/2`;
        y = `h-text_h-80`;
        break;
      default:
        fontsize = 52;
        color = "white";
        x = `(w-text_w)/2`;
        y = `(h-text_h)/2`;
    }

    const fontFile = AI_CONFIG.ffmpeg.fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");

    return `drawtext=fontfile='${fontFile}':text='${text}':fontsize=${fontsize}:fontcolor=${color}:borderw=3:bordercolor=black@0.8:shadowx=2:shadowy=2:x='${x}':y='${y}':enable='${enable}':alpha='${alpha}'`;
  });

  return filters.join(",");
}

async function downloadToTmp(storageKey: string, localPath: string): Promise<void> {
  const bucket = process.env.DO_SPACES_BUCKET!;
  const res = await spacesClient.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  await fs.writeFile(localPath, Buffer.concat(chunks));
}

async function uploadFromTmp(localPath: string, storageKey: string): Promise<string> {
  const bucket = process.env.DO_SPACES_BUCKET!;
  const data = await fs.readFile(localPath);
  await spacesClient.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: data,
      ContentType: "video/mp4",
      ACL: "public-read",
    })
  );
  return spacesPublicUrl(storageKey);
}

export async function renderAnimationsOnVideo(params: {
  videoStorageKey: string;
  animationSpecs: AnimationSpec[];
  outputStorageKey: string;
}): Promise<string> {
  const { videoStorageKey, animationSpecs, outputStorageKey } = params;

  const tmpDir = AI_CONFIG.ffmpeg.tmpDir;
  await fs.mkdir(tmpDir, { recursive: true });

  const inputPath = path.join(tmpDir, `anim_input_${Date.now()}.mp4`);
  const outputPath = path.join(tmpDir, `anim_output_${Date.now()}.mp4`);

  try {
    await downloadToTmp(videoStorageKey, inputPath);

    const filterChain = buildFilterChain(animationSpecs);
    const ffmpeg = AI_CONFIG.ffmpeg.path;

    let cmd: string;
    if (filterChain) {
      cmd = `"${ffmpeg}" -y -i "${inputPath}" -vf "${filterChain}" -c:v libx264 -c:a copy -preset fast "${outputPath}"`;
    } else {
      // No animations — just copy the video unchanged
      cmd = `"${ffmpeg}" -y -i "${inputPath}" -c copy "${outputPath}"`;
    }

    await execAsync(cmd, { timeout: 120_000 });
    const url = await uploadFromTmp(outputPath, outputStorageKey);
    return url;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { AI_CONFIG } from "@/config/aiTools";
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

const ANIMATION_SYSTEM_PROMPT = `You are a video motion graphics specialist for short-form Thai social media videos (15 seconds).
Given a Thai script, per-sentence voice timestamps, and scene plan, you generate animated text overlay specs.

Rules:
- Create 2-4 animation overlays total (don't overcrowd)
- Use "kinetic_text" for the hook (first 3s) — large center text that grabs attention
- Use "lower_third" for product name or key claim — appears at bottom during the content section
- Use "cta_banner" for the call-to-action at the end (last 2s)
- Keep text short: max 5 words per overlay
- Timestamps must be in milliseconds (ms), within the total video duration
- Each overlay should have a fade-in/out of ~300ms built in (start 300ms before speech, end 300ms after)

Respond ONLY with a valid JSON array of AnimationSpec objects. No markdown, no explanation.
Schema: [{ "startMs": number, "endMs": number, "type": "kinetic_text"|"lower_third"|"cta_banner", "text": "string", "effect": "fade_in"|"fade_slide_up"|"slide_in_left" }]`;

export async function generateAnimationSpec(params: {
  scriptThai: string;
  timedSegments: TimedSegment[];
  scenePlan: ScenePlan[];
  hookThai: string;
  durationSeconds: number;
}): Promise<AnimationSpec[]> {
  const { scriptThai, timedSegments, scenePlan, hookThai, durationSeconds } = params;

  if (!AI_CONFIG.claude.apiKey) {
    return _defaultAnimationSpec(timedSegments, durationSeconds);
  }

  const userMessage = `Thai script: "${scriptThai}"
Hook (first 3s): "${hookThai}"
Total duration: ${durationSeconds}s

Voice timeline (per sentence):
${timedSegments.map((s) => `  [${(s.startSecond * 1000).toFixed(0)}ms–${(s.endSecond * 1000).toFixed(0)}ms] "${s.textThai}"`).join("\n")}

Scene plan:
${scenePlan.map((s) => `  Scene ${s.sceneNumber} (${s.durationSeconds}s): ${s.visualDescriptionThai}`).join("\n")}

Generate animation overlay specs in JSON.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AI_CONFIG.claude.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_CONFIG.claude.model,
        max_tokens: 1024,
        system: ANIMATION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
    const data = await res.json();
    const raw = data.content?.[0]?.text ?? "";
    const specs = JSON.parse(raw) as AnimationSpec[];
    return Array.isArray(specs) ? specs : _defaultAnimationSpec(timedSegments, durationSeconds);
  } catch (err) {
    console.error("[animationService] Claude API failed, using defaults:", err);
    return _defaultAnimationSpec(timedSegments, durationSeconds);
  }
}

function _defaultAnimationSpec(segments: TimedSegment[], durationSeconds: number): AnimationSpec[] {
  const specs: AnimationSpec[] = [];
  const totalMs = durationSeconds * 1000;

  if (segments[0]) {
    specs.push({
      startMs: Math.max(0, segments[0].startSecond * 1000 - 300),
      endMs: Math.min(totalMs, segments[0].endSecond * 1000 + 300),
      type: "kinetic_text",
      text: segments[0].textThai.split(" ").slice(0, 4).join(" "),
      effect: "fade_slide_up",
    });
  }

  const lastSeg = segments[segments.length - 1];
  if (lastSeg) {
    specs.push({
      startMs: Math.max(0, lastSeg.startSecond * 1000 - 200),
      endMs: totalMs,
      type: "cta_banner",
      text: lastSeg.textThai.split(" ").slice(0, 4).join(" "),
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

    return `drawtext=text='${text}':fontsize=${fontsize}:fontcolor=${color}:borderw=3:bordercolor=black@0.8:shadowx=2:shadowy=2:x=${x}:y=${y}:enable='${enable}':alpha='${alpha}'`;
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

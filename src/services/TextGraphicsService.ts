import {
  DEFAULT_TEXT_GRAPHIC_CHOICE,
  TEXT_GRAPHIC_POSITIONS,
  TEXT_GRAPHIC_STYLE_GUIDE,
  TEXT_GRAPHIC_STYLE_IDS,
  isTextGraphicChoice,
  isTextGraphicStyleId,
  type TextGraphicChoice,
  type TextGraphicStyleId,
} from "@/config/textGraphicStyles";
import { AI_CONFIG } from "@/config/aiTools";
import { sceneMontageSeconds } from "@/config/montage";
import { DEVICE_SCENE_CROSSFADE_SECONDS } from "@/lib/mobile/deviceRenderCaptions";
import { DEVICE_MUSIC_LEAD_IN_SECONDS } from "@/lib/mobile/deviceRenderAudio";
import {
  TEXT_GRAPHIC_LIMITS,
  fallbackTextGraphicItems,
  parseTextGraphicsPlan,
  planFingerprint,
  sanitizeTextGraphicItems,
  sceneWindows,
  type SceneWindow,
  type TextGraphicItem,
  type TextGraphicsPlan,
} from "@/lib/textGraphics/plan";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories";
import type { ScenePlan, VideoGenerationJob } from "@/domain/models/VideoGenerationJob";

/**
 * Writes the per-request text-graphics plan with Claude.
 *
 * Claude sees each scene's small picture (the same poster/derivative the
 * storyboard and framing already use — no original leaves the phone), the
 * voice timeline, the business name and the brief, and returns which words to
 * show in each scene, when, and — on "auto" — which style pack fits.
 *
 * Nothing here can block or fail a render: every failure path ends in the
 * deterministic fallback plan (business name hook + closing card). The plan is
 * cached on the job with a fingerprint of its inputs, so the studio's preview
 * and the final render share one Claude call when nothing changed in between.
 */

interface PlanInputs {
  choice: TextGraphicChoice;
  windows: SceneWindow[];
  durationSeconds: number;
  leadInSeconds: number;
  timeline: { start: number; end: number; th: string; en: string }[];
  brand: string;
  brief: string;
  scriptThai: string;
  hookLine: string;
  imageUrls: (string | null)[];
  fingerprint: string;
}

const inFlight = new Map<string, Promise<TextGraphicsPlan>>();

const CTA_FALLBACK_TITLE = "แวะมาเลย!";

const SYSTEM_PROMPT = `You are a senior motion-graphics copywriter and designer for short social videos (TikTok, Reels, Shorts, YouTube) made by small Thai businesses — restaurants, cafés, street food, shops, spas, hotels.

You write the ON-SCREEN TEXT GRAPHICS that sit on top of the video: an opening hook, a short label for the scenes that deserve one, and a closing call-to-action card. Subtitles of the voiceover are already burned in at the bottom of the frame, so your text must ADD information (the dish, the product, the place, the offer, the feeling) — never repeat the subtitle sentence.

You can see one picture per scene. Name what is actually visible when you recognise it (e.g. "ข้าวหน้าแซลมอน", "ลาเต้เย็น"). Never invent prices, discounts, opening hours or facts that are not in the script, the brief or the picture.

Item kinds:
- "hook": exactly one, starting at 0.3 s and lasting 3–4 s. title = the business name or a 2–5 word attention line (Thai). sub = one short Thai line saying what/where. kicker = 1–3 English words for the category, e.g. "JAPANESE RESTAURANT", "CAFÉ & BAKERY".
- "label": at most one per scene, only for scenes of 2.2 s or longer, and not every scene — pick the 3–6 strongest moments. title = 2–5 Thai words naming the dish/product/feature. sub = the same in short English (Title Case). Optional badge = 1–3 Thai words for a genuine highlight the voice or picture supports ("แนะนำ!", "ขายดี", "ห้ามพลาด!", "ใหม่!") — at most 3 badges in the whole video. Optional num = "01", "02"… only when the scenes are clearly steps or a list.
- "cta": exactly one over the last 2.5–4 s, ending at the video's end. title = a 2–4 word Thai invitation for the button ("แวะมาชิมกันนะ!", "สั่งเลย!", "จองเลย!"). brand = the business name. place = the location/branch in short Latin or Thai if known, else "".

Timing: items never overlap (leave ≥ 0.2 s between them), each lasts at least 1.5 s, a label sits INSIDE its scene's window (start ~0.2 s after the scene starts, end ~0.2 s before it ends), and nothing goes past the video's duration.

Length budgets (characters): title ≤ ${TEXT_GRAPHIC_LIMITS.title}, sub ≤ ${TEXT_GRAPHIC_LIMITS.sub}, kicker ≤ ${TEXT_GRAPHIC_LIMITS.kicker}, badge ≤ ${TEXT_GRAPHIC_LIMITS.badge}, brand ≤ ${TEXT_GRAPHIC_LIMITS.brand}. Short and punchy beats complete.

Position (labels only, optional): leave "position" empty to use the style's default place. Set it when the default would cover the main subject in that scene's picture — the dish, the product, a face — choosing the free side: "top-left", "top-center", "top-right", "middle-left" or "middle-right". The bottom of the frame is reserved for subtitles. Varying positions between scenes is good when the pictures allow it.

Style packs (choose only when asked to):
${TEXT_GRAPHIC_STYLE_IDS.map((id) => `- "${id}": ${TEXT_GRAPHIC_STYLE_GUIDE[id]}.`).join("\n")}

Answer by calling the write_text_graphics tool.`;

const TOOL = {
  name: "write_text_graphics",
  description: "Return the text graphics for this video.",
  input_schema: {
    type: "object",
    properties: {
      style: { type: "string", enum: [...TEXT_GRAPHIC_STYLE_IDS] },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["hook", "label", "cta"] },
            start: { type: "number" },
            end: { type: "number" },
            title: { type: "string" },
            sub: { type: "string" },
            kicker: { type: "string" },
            num: { type: "string" },
            badge: { type: "string" },
            brand: { type: "string" },
            place: { type: "string" },
            position: {
              type: "string",
              enum: ["", ...TEXT_GRAPHIC_POSITIONS],
            },
          },
          required: ["kind", "start", "end", "title"],
        },
      },
    },
    required: ["style", "items"],
  },
} as const;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** The voice timeline (voice seconds) shifted onto the picture timeline. */
function readTimeline(job: VideoGenerationJob, shift: number): PlanInputs["timeline"] {
  const raw = job.subtitleTimeline ?? job.voiceTimestamps;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((seg) => {
        const s = (seg ?? {}) as Record<string, unknown>;
        return {
          start: Math.round((toNumber(s.startSecond) + shift) * 100) / 100,
          end: Math.round((toNumber(s.endSecond) + shift) * 100) / 100,
          th: typeof s.textThai === "string" ? s.textThai : "",
          en: typeof s.textEnglish === "string" ? s.textEnglish : "",
        };
      })
      .filter((seg) => seg.end > seg.start);
  } catch {
    return [];
  }
}

function readScenePlan(raw: string | null | undefined): ScenePlan[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ScenePlan[]) : [];
  } catch {
    return [];
  }
}

export function windowsForScenePlan(plan: ScenePlan[]): SceneWindow[] {
  return sceneWindows(
    plan.map((scene, index) => ({
      sceneNumber: scene.sceneNumber ?? index + 1,
      seconds: sceneMontageSeconds(scene),
      description: scene.visualDescriptionThai ?? "",
      firstAssetIndex: scene.assets?.[0]?.assetIndex ?? scene.imageIndexes?.[0] ?? null,
    })),
    DEVICE_SCENE_CROSSFADE_SECONDS
  );
}

export class TextGraphicsService {
  /**
   * The plan for `job`, written if needed.
   *
   * @param options.choice     overrides the job's saved choice (studio preview)
   * @param options.scenePlan  overrides the approved scene plan (studio preview,
   *                           before production is approved)
   * @param options.musicSelected overrides whether the master opens on music
   * @param options.timeoutMs  how long to wait for Claude before using the fallback
   * @returns null when the choice is "none" or there is nothing to time against
   */
  async ensurePlan(
    job: VideoGenerationJob,
    options: {
      choice?: TextGraphicChoice;
      scenePlan?: ScenePlan[];
      musicSelected?: boolean;
      timeoutMs?: number;
      fresh?: boolean;
    } = {}
  ): Promise<TextGraphicsPlan | null> {
    const choice: TextGraphicChoice =
      options.choice ??
      (isTextGraphicChoice(job.selectedTextStyle) ? job.selectedTextStyle : "none");
    if (choice === "none") return null;

    const inputs = await this._inputs(job, choice, options);
    if (!inputs) return null;

    const stored = parseTextGraphicsPlan(job.textGraphicsPlan);
    if (!options.fresh && stored && stored.fingerprint === inputs.fingerprint) return stored;

    const key = `${job.id}:${inputs.fingerprint}`;
    let pending = options.fresh ? undefined : inFlight.get(key);
    if (!pending) {
      pending = this._write(inputs).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
      // Persist whenever it lands, even if this caller stops waiting.
      void pending.then((plan) => this._save(job.id, plan)).catch(() => undefined);
    }

    const timeoutMs = options.timeoutMs ?? 45_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      const plan = await Promise.race([pending, timedOut]);
      return plan ?? this._fallback(inputs);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Save the requester's choice. Never throws: a missing column must not block production. */
  async saveChoice(jobId: string, choice: TextGraphicChoice): Promise<void> {
    try {
      await videoGenerationJobRepository.update(jobId, { selectedTextStyle: choice });
    } catch (err) {
      console.error("[textGraphics] could not save the style choice:", err);
    }
  }

  private async _save(jobId: string, plan: TextGraphicsPlan): Promise<void> {
    try {
      await videoGenerationJobRepository.update(jobId, { textGraphicsPlan: JSON.stringify(plan) });
    } catch (err) {
      console.error("[textGraphics] could not save the plan:", err);
    }
  }

  private async _inputs(
    job: VideoGenerationJob,
    choice: TextGraphicChoice,
    options: { scenePlan?: ScenePlan[]; musicSelected?: boolean }
  ): Promise<PlanInputs | null> {
    const scenePlan = options.scenePlan ?? readScenePlan(job.approvedScenePlan ?? job.scenePlan);
    const windows = windowsForScenePlan(scenePlan);
    const durationSeconds = windows.length > 0 ? windows[windows.length - 1].end : 0;
    if (!(durationSeconds > 3)) return null;

    const musicSelected = options.musicSelected ?? Boolean(job.selectedMusicTrack && job.selectedMusicTrack !== "none");
    const leadInSeconds = musicSelected ? DEVICE_MUSIC_LEAD_IN_SECONDS : 0;
    const timeline = readTimeline(job, leadInSeconds);

    const request = await clipRequestRepository.findById(job.requestId);
    const brand = (request?.placeName || request?.title || "").trim();
    const brief = (request?.description ?? "").trim();

    const { getOrderedSourceAssets } = await import("@/lib/sourceAssets");
    const ordered = await getOrderedSourceAssets(job.requestId);
    const imageUrls = windows.map((w) => {
      const asset = w.firstAssetIndex != null ? ordered[w.firstAssetIndex] : undefined;
      return asset ? asset.url || asset.thumbnailUrl || null : null;
    });

    return {
      choice,
      windows,
      durationSeconds,
      leadInSeconds,
      timeline,
      brand,
      brief,
      scriptThai: job.approvedScriptThai ?? job.hookThai ?? "",
      hookLine: (job.approvedHookThai ?? job.hookThai ?? "").trim(),
      imageUrls,
      fingerprint: planFingerprint({
        choice,
        windows,
        timeline: timeline.map((seg) => [seg.start, seg.end, seg.th]),
        leadInSeconds,
        brand,
      }),
    };
  }

  private _fallback(inputs: PlanInputs): TextGraphicsPlan {
    return {
      version: 1,
      choice: inputs.choice,
      styleId: isTextGraphicStyleId(inputs.choice) ? inputs.choice : "premium",
      items: fallbackTextGraphicItems({
        durationSeconds: inputs.durationSeconds,
        brand: inputs.brand,
        hookLine: inputs.hookLine,
        ctaTitle: CTA_FALLBACK_TITLE,
        place: "",
      }),
      source: "fallback",
      fingerprint: inputs.fingerprint,
      durationSeconds: inputs.durationSeconds,
      createdAt: new Date().toISOString(),
    };
  }

  private async _write(inputs: PlanInputs): Promise<TextGraphicsPlan> {
    const apiKey = AI_CONFIG.claude.apiKey;
    if (!apiKey) return this._fallback(inputs);
    try {
      const result = await this._askClaude(inputs, apiKey);
      const items = sanitizeTextGraphicItems(result.items, inputs.durationSeconds);
      if (items.length === 0) return this._fallback(inputs);
      const styleId: TextGraphicStyleId = isTextGraphicStyleId(inputs.choice)
        ? inputs.choice
        : isTextGraphicStyleId(result.style)
          ? result.style
          : "premium";
      return {
        version: 1,
        choice: inputs.choice,
        styleId,
        items,
        source: "claude",
        fingerprint: inputs.fingerprint,
        durationSeconds: inputs.durationSeconds,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error("[textGraphics] Claude failed, using the fallback plan:", err);
      return this._fallback(inputs);
    }
  }

  private async _askClaude(
    inputs: PlanInputs,
    apiKey: string
  ): Promise<{ style: unknown; items: unknown }> {
    const { downloadAsBase64 } = await import("@/lib/ai/geminiSubtitlesService");
    const content: unknown[] = [];

    // One picture per scene, labelled, at most 12.
    const pictures = await Promise.all(
      inputs.imageUrls.slice(0, 12).map(async (url) => {
        if (!url) return null;
        try {
          const { data, mimeType } = await downloadAsBase64(url);
          if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) return null;
          if (data.length > 4_500_000) return null;
          return { data, mimeType };
        } catch {
          return null;
        }
      })
    );
    inputs.windows.slice(0, 12).forEach((w, i) => {
      content.push({
        type: "text",
        text: `Scene ${w.sceneNumber}: ${w.start.toFixed(2)}–${w.end.toFixed(2)} s (${(w.end - w.start).toFixed(1)} s). Storyboard note: ${w.description || "—"}`,
      });
      const picture = pictures[i];
      if (picture) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: picture.mimeType, data: picture.data },
        });
      }
    });

    const timeline = inputs.timeline
      .map((seg) => `  ${seg.start.toFixed(2)}–${seg.end.toFixed(2)} s  ${seg.th}${seg.en ? `  (${seg.en})` : ""}`)
      .join("\n");

    content.push({
      type: "text",
      text: [
        `Business name: ${inputs.brand || "(unknown)"}`,
        `Brief from the owner: ${inputs.brief || "(none)"}`,
        `Video duration: ${inputs.durationSeconds.toFixed(2)} s (the voice starts at ${inputs.leadInSeconds.toFixed(1)} s).`,
        `Voiceover with timing (these lines are already shown as subtitles):`,
        timeline || "  (no timing available)",
        `Full script (Thai): ${inputs.scriptThai || "(none)"}`,
        inputs.choice === "auto"
          ? `Choose the style pack that best fits this business and footage.`
          : `The style pack is fixed to "${inputs.choice}" — return it as the style and match the tone of your words to it.`,
        `Write the text graphics now.`,
      ].join("\n"),
    });

    const model = (process.env.TEXT_GRAPHICS_MODEL ?? AI_CONFIG.claude.model).trim();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": AI_CONFIG.claude.apiVersion,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: 0.6,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content }],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Claude ${response.status}: ${body.slice(0, 500)}`);
    }
    const json = (await response.json()) as {
      content?: { type: string; name?: string; input?: { style?: unknown; items?: unknown } }[];
    };
    const call = json.content?.find((block) => block.type === "tool_use" && block.name === TOOL.name);
    if (!call?.input) throw new Error("Claude returned no text graphics");
    return { style: call.input.style, items: call.input.items };
  }
}

export const textGraphicsService = new TextGraphicsService();

export type { TextGraphicItem };
export { DEFAULT_TEXT_GRAPHIC_CHOICE };

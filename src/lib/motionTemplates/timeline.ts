/**
 * The Look's timeline for a job: where the scene cuts land and how long the
 * finished video runs. Sent in the manifest (`template.beats`,
 * `template.endSeconds`) so the phone renderers can hit every cut.
 */
import { sceneMontageSeconds } from "@/config/montage";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";
import { DEVICE_SCENE_CROSSFADE_SECONDS } from "@/lib/mobile/deviceRenderCaptions";
import { sceneWindows } from "@/lib/textGraphics/plan";
import { normaliseTimeline, type TemplateTimeline } from "./motion";

/**
 * Cuts are placed mid-crossfade — the moment the picture actually changes —
 * on the same picture timeline the text graphics use (`sceneWindows`). The
 * length follows the renderers' rule: `max(picture, voice + lead-in)`.
 */
export function templateTimelineForScenePlan(
  plan: Pick<ScenePlan, "durationSeconds" | "assets">[],
  voiceSeconds: number | null | undefined,
  leadInSeconds: number
): TemplateTimeline {
  const windows = sceneWindows(
    plan.map((scene) => ({ seconds: sceneMontageSeconds(scene as Parameters<typeof sceneMontageSeconds>[0]) })),
    DEVICE_SCENE_CROSSFADE_SECONDS
  );
  const beats = windows.slice(1).map((w) => Math.round((w.start + DEVICE_SCENE_CROSSFADE_SECONDS / 2) * 100) / 100);
  const picture = windows.length > 0 ? windows[windows.length - 1].end : 0;
  const voice = typeof voiceSeconds === "number" && voiceSeconds > 0 ? voiceSeconds + leadInSeconds : 0;
  const end = Math.max(picture, voice);
  return normaliseTimeline(beats, end > 0 ? Math.round(end * 100) / 100 : null);
}

/** Parse a stored scene plan (JSON) defensively; [] when unreadable. */
export function readScenePlanJson(raw: string | null | undefined): ScenePlan[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ScenePlan[]) : [];
  } catch {
    return [];
  }
}

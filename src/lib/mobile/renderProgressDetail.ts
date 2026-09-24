import type { DeviceRenderManifest } from "@/lib/mobile/deviceRenderContract";

/**
 * Turn the phone's bare percentage into what it is actually working on.
 *
 * The native renderers report one number for a render: about 0–15 % while
 * inputs are fetched, 15–95 % while the video is encoded from start to finish,
 * and the rest for the cover (`ManifestJob`, both platforms). An encode runs
 * through the timeline in order, so the percentage within that 15–95 window IS
 * a position in the video — and the manifest says what is at every position:
 * which scene and shot, from which photo or clip, and which caption is on
 * screen. That turns "42 %" into "Scene 2 · shot 3 of 8 — clip IMG_1234.mp4".
 *
 * Pure and platform-free, so it is tested directly.
 */

const RENDER_FROM = 15;
const RENDER_TO = 95;

const LOOK_NAMES: Record<string, string> = {
  none: "Clean",
  clean_frame: "Minimal frame",
  framed_cream: "Warm frame",
  editorial: "Editorial",
};

export interface TimelineShot {
  start: number;
  end: number;
  sceneNumber: number;
  shotInScene: number;
  shotsInScene: number;
  flatIndex: number;
  kind: "image" | "clip";
  name: string;
  trimStart: number | null;
  trimEnd: number | null;
}

export interface ManifestPlan {
  stage: DeviceRenderManifest["stage"];
  /** Whether this render draws the shots itself (montage, or from sources). */
  drawsShots: boolean;
  shots: TimelineShot[];
  sceneCount: number;
  pictureSeconds: number;
  captionCount: number;
  captionStarts: number[];
  lookName: string;
  mixesSound: boolean;
}

export function planFromManifest(
  manifest: DeviceRenderManifest,
  /** localId → the file's name on the phone, for readable shot labels. */
  fileNames: Map<string, string> = new Map()
): ManifestPlan {
  const sourceById = new Map(manifest.sources.map((source) => [source.assetId, source]));
  const shots: TimelineShot[] = [];
  let cursor = 0;
  let flatIndex = 0;
  let photoNumber = 0;
  let clipNumber = 0;
  const labelFor = new Map<string, string>();

  manifest.scenes.forEach((scene, sceneIndex) => {
    scene.assets.forEach((shot, shotIndex) => {
      const source = sourceById.get(shot.sourceAssetId);
      const kind = source?.kind ?? "image";
      let name = labelFor.get(shot.sourceAssetId);
      if (!name) {
        const fileName = source?.localId ? fileNames.get(source.localId) : undefined;
        name =
          fileName ??
          (kind === "clip" ? `clip ${++clipNumber}` : `photo ${++photoNumber}`);
        labelFor.set(shot.sourceAssetId, name);
      }
      shots.push({
        start: cursor,
        end: cursor + shot.durationSeconds,
        sceneNumber: sceneIndex + 1,
        shotInScene: shotIndex + 1,
        shotsInScene: scene.assets.length,
        flatIndex: flatIndex++,
        kind,
        name,
        trimStart: kind === "clip" ? (shot.trimStartSeconds ?? 0) : null,
        trimEnd: kind === "clip" ? (shot.trimEndSeconds ?? null) : null,
      });
      cursor += shot.durationSeconds;
    });
  });

  const drawsShots = manifest.stage === "montage" || manifest.buildFromSources;
  return {
    stage: manifest.stage,
    drawsShots,
    shots,
    sceneCount: manifest.scenes.length,
    pictureSeconds: cursor,
    captionCount: manifest.captions.length,
    captionStarts: manifest.captions.map((caption) => caption.startSeconds),
    lookName: LOOK_NAMES[manifest.template.id] ?? manifest.template.id,
    mixesSound: Boolean(manifest.voiceUrl),
  };
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * One line saying what the render is on, for a native percentage.
 * `totalSeconds` is the length of the file being written (the picture, or the
 * master's length for a final made from a downloaded master).
 */
export function describeRenderPosition(
  plan: ManifestPlan,
  nativePercent: number,
  totalSeconds: number = plan.pictureSeconds
): string {
  if (nativePercent < RENDER_FROM) {
    return plan.mixesSound && plan.stage !== "montage"
      ? "Mixing the voice-over with the background music…"
      : "Opening your photos and clips…";
  }
  if (nativePercent >= RENDER_TO) return "Taking the cover picture from the finished video…";

  const fraction = (nativePercent - RENDER_FROM) / (RENDER_TO - RENDER_FROM);
  const length = totalSeconds > 0 ? totalSeconds : plan.pictureSeconds;
  const at = fraction * length;
  const clock = `${formatClock(at)} of ${formatClock(length)}`;

  const parts: string[] = [];
  if (plan.drawsShots && plan.shots.length > 0) {
    const shot =
      plan.shots.find((entry) => at >= entry.start && at < entry.end) ??
      plan.shots[plan.shots.length - 1];
    const what =
      shot.kind === "clip"
        ? `clip ${shot.name}${
            shot.trimEnd != null
              ? ` (${formatClock(shot.trimStart ?? 0)}–${formatClock(shot.trimEnd)})`
              : ""
          }`
        : `photo ${shot.name}`;
    parts.push(
      `Scene ${shot.sceneNumber} of ${plan.sceneCount} · shot ${shot.flatIndex + 1} of ${
        plan.shots.length
      } — ${what}`
    );
  }

  if (plan.stage === "final") {
    const shown = plan.captionStarts.filter((start) => start <= at).length;
    parts.push(
      plan.captionCount > 0
        ? `${plan.lookName} look · caption ${Math.max(1, shown)} of ${plan.captionCount}`
        : `${plan.lookName} look`
    );
  } else if (plan.stage === "master") {
    parts.push("adding voice-over and music");
  }

  return `${parts.join(" · ")} · ${clock}`;
}

import type { MontageTransition, MotionPreset } from "@/config/montage";
import { DEVICE_MUSIC_LEAD_IN_SECONDS, mixedTrackDurationSeconds } from "@/lib/mobile/deviceRenderAudio";
import {
  DEVICE_SCENE_CROSSFADE_SECONDS,
  DEVICE_TRANSITION_SECONDS,
} from "@/lib/mobile/deviceRenderCaptions";
import { findSource, shotFrameZoom, type EditorDocument, type EditorSource } from "./editorState";

/**
 * The finished video's clock, worked out before anything is rendered, so the
 * Sound step can play the storyboard and the voice TOGETHER and have that
 * preview run exactly as long as the video the Render step makes.
 *
 * WHERE THE TIME GOES (read off the renderers, not guessed):
 *
 *   • Picture. Every shot occupies its slot (`durationSeconds`) end to end.
 *     Both phone renderers total the picture this way
 *     (`RenderManifest.pictureSeconds()` on Android, `pictureSeconds` on iOS):
 *     "dissolves borrow, never add".
 *
 *   • Scene transitions. A 0.2 s dissolve INTO each shot — between scenes
 *     `DEVICE_SCENE_CROSSFADE_SECONDS`, within a scene
 *     `DEVICE_TRANSITION_SECONDS`, none for a scene set to "cut"
 *     (`dissolveBeforeFlatIndex`). The incoming shot fades in over the tail of
 *     the outgoing one, so a transition takes NO time of its own: there is no
 *     gap in the picture at a scene change, and none is inserted here — one
 *     would push every later shot off the voice and make the preview longer
 *     than the video.
 *
 *   • Music lead-in. With background music the voice starts
 *     `DEVICE_MUSIC_LEAD_IN_SECONDS` (0.6 s) after the picture — a music-only
 *     beat. Without music it starts at 0. This is the one real gap between
 *     picture and voice, and it sits at the start, not at the transitions.
 *
 *   • Length. `max(picture, voice + lead-in)` (`mixedTrackDurationSeconds`,
 *     used by both native engines and the server compose). When the voice
 *     runs past the picture, the leftover is BLACK with the voice still
 *     playing — the black tail here is that same stretch.
 *
 * Pure, so it is testable.
 */

export interface SoundPreviewShot {
  source: EditorSource;
  sceneIndex: number;
  /** Index among the shots that are shown, in order. */
  flatIndex: number;
  startsAt: number;
  endsAt: number;
  durationSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  motion: MotionPreset;
  focusX: number;
  focusY: number;
  frameZoom: number;
  /** Dissolve into this shot, seconds — taken from the overlap, not added. */
  dissolveSeconds: number;
  /** First shot of its scene. */
  opensScene: boolean;
}

export interface SoundPreviewTransition {
  /** Picture time the incoming shot starts at. */
  at: number;
  seconds: number;
  kind: MontageTransition;
  /** Between two scenes, rather than between two shots of one scene. */
  betweenScenes: boolean;
}

export interface SoundPreviewTimeline {
  shots: SoundPreviewShot[];
  transitions: SoundPreviewTransition[];
  /** Where each scene starts on the clock, for the track's scene marks. */
  sceneStarts: { sceneIndex: number; at: number }[];
  pictureSeconds: number;
  /** 0.6 with background music, 0 without. */
  leadInSeconds: number;
  voiceStart: number;
  /** Null until the voice's length is known. */
  voiceEnd: number | null;
  /** The finished video's length. */
  totalSeconds: number;
  /** Picture-less stretch at the end (voice over black), or null. */
  blackTail: { start: number; end: number } | null;
}

function dissolveFor(transition: MontageTransition, firstOfScene: boolean): number {
  if (transition === "cut") return 0;
  return firstOfScene ? DEVICE_SCENE_CROSSFADE_SECONDS : DEVICE_TRANSITION_SECONDS;
}

export function buildSoundPreviewTimeline(
  document: Pick<EditorDocument, "scenes" | "sources" | "ratio" | "musicTrackId">,
  voiceSeconds: number | null | undefined
): SoundPreviewTimeline {
  const shots: SoundPreviewShot[] = [];
  const transitions: SoundPreviewTransition[] = [];
  const sceneStarts: { sceneIndex: number; at: number }[] = [];
  let cursor = 0;

  document.scenes.forEach((scene, sceneIndex) => {
    let firstOfScene = true;
    scene.shots.forEach((shot) => {
      const source = findSource(document as EditorDocument, shot.sourceId);
      if (!source || !(shot.durationSeconds > 0)) return;
      const flatIndex = shots.length;
      // The very first shot of the video has nothing to dissolve from.
      // Never longer than half of either neighbouring shot (phones' rule).
      const previous = shots[flatIndex - 1];
      const dissolveSeconds =
        flatIndex === 0
          ? 0
          : Math.min(
              dissolveFor(scene.transitionIn, firstOfScene),
              Math.min(previous.durationSeconds, shot.durationSeconds) / 2
            );
      if (firstOfScene) sceneStarts.push({ sceneIndex, at: cursor });
      if (flatIndex > 0) {
        transitions.push({
          at: cursor,
          seconds: dissolveSeconds,
          kind: firstOfScene ? scene.transitionIn : scene.transitionIn === "cut" ? "cut" : "fade",
          betweenScenes: firstOfScene,
        });
      }
      shots.push({
        source,
        sceneIndex,
        flatIndex,
        startsAt: cursor,
        endsAt: cursor + shot.durationSeconds,
        durationSeconds: shot.durationSeconds,
        trimStartSeconds: shot.trimStartSeconds,
        trimEndSeconds: shot.trimEndSeconds,
        motion: source.kind === "clip" ? "static" : shot.motion,
        focusX: shot.focusX,
        focusY: shot.focusY,
        frameZoom: shotFrameZoom(shot, source, document.ratio),
        dissolveSeconds,
        opensScene: firstOfScene,
      });
      cursor += shot.durationSeconds;
      firstOfScene = false;
    });
  });

  const pictureSeconds = cursor;
  const leadInSeconds = document.musicTrackId ? DEVICE_MUSIC_LEAD_IN_SECONDS : 0;
  const voice =
    typeof voiceSeconds === "number" && Number.isFinite(voiceSeconds) && voiceSeconds > 0
      ? voiceSeconds
      : null;
  const totalSeconds =
    voice == null
      ? pictureSeconds
      : mixedTrackDurationSeconds({
          videoDurationSeconds: pictureSeconds,
          voiceDurationSeconds: voice,
          leadInSeconds,
        });
  const blackTail =
    totalSeconds - pictureSeconds > 0.05 ? { start: pictureSeconds, end: totalSeconds } : null;

  return {
    shots,
    transitions,
    sceneStarts,
    pictureSeconds,
    leadInSeconds,
    voiceStart: leadInSeconds,
    voiceEnd: voice == null ? null : leadInSeconds + voice,
    totalSeconds,
    blackTail,
  };
}

/** The shot on screen at clock time `t`, or null over the black tail. */
export function shotAt(timeline: SoundPreviewTimeline, t: number): SoundPreviewShot | null {
  if (t >= timeline.pictureSeconds) return null;
  for (const shot of timeline.shots) {
    if (t < shot.endsAt) return shot;
  }
  return null;
}

/**
 * Where the voice file should be at clock time `t`: null before the lead-in
 * ends and after the voice ends (it should be silent then).
 */
export function voiceTimeAt(timeline: SoundPreviewTimeline, t: number): number | null {
  if (t < timeline.voiceStart) return null;
  if (timeline.voiceEnd != null && t >= timeline.voiceEnd) return null;
  return t - timeline.voiceStart;
}

/**
 * Camera move for a still at `progress` (0..1), as numbers so the preview can
 * be scrubbed. Same keyframes as the storyboard preview (`motionFrames`).
 */
export function motionTransformAt(motion: MotionPreset, progress: number): string {
  const p = Math.min(1, Math.max(0, progress));
  const lerp = (a: number, b: number) => a + (b - a) * p;
  switch (motion) {
    case "ken_burns_in":
      return `scale(${lerp(1, 1.25)})`;
    case "ken_burns_out":
      return `scale(${lerp(1.25, 1)})`;
    case "pan_left":
      return `scale(1.18) translateX(${lerp(-7, 7)}%)`;
    case "pan_right":
      return `scale(1.18) translateX(${lerp(7, -7)}%)`;
    default:
      return "scale(1)";
  }
}

/** Clip playback rate filling its slot — slowed, never sped up (renderer rule). */
export function clipRateFor(shot: SoundPreviewShot): number {
  const end = shot.trimEndSeconds ?? shot.trimStartSeconds + shot.durationSeconds;
  const window = Math.max(0.1, end - shot.trimStartSeconds);
  return Math.min(1, Math.max(0.25, window / shot.durationSeconds));
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./studio.css";

import {
  MONTAGE_TRANSITIONS,
  MOTION_PRESETS,
  minMontageTotalSeconds,
  type MontageTransition,
  type MotionPreset,
} from "@/config/montage";
import { MOTION_TEMPLATES } from "@/config/motionTemplates";
import { BACKGROUND_MUSIC_TRACKS } from "@/config/backgroundMusic";
import { DEFAULT_ELEVENLABS_VOICE_ID, type ElevenLabsVoiceId } from "@/config/elevenLabsVoices";
import {
  PIPELINE_STEP_DESCRIPTIONS,
  VideoGenerationStep,
} from "@/domain/enums/VideoGenerationStep";
import { Platform, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";
import { loadLocalMediaIndex } from "@/features/requests/localMediaStore";
import type { CaptionLanguage } from "@/lib/mobile/deviceRenderCaptions";
import { cancelDeviceRender } from "@/lib/mobile/deviceRenderBridge";
import {
  checkDeviceRenderAvailability,
  explainRefusal,
  runDeviceRender,
  type DeviceRenderAvailability,
  type DeviceRenderProgress,
} from "@/lib/mobile/deviceRenderClient";
import {
  autoArrange,
  documentDurationSeconds,
  emptyDocument,
  findSource,
  nextId,
  measurePictureAspect,
  readImagePoster,
  retimeScenes,
  scenePlanFromScenes,
  scenesFromStoryboard,
  scenesPlaySeconds,
  storyboardFromScenes,
  submissionProblems,
  validateDocument,
  type EditorBrief,
  type EditorDocument,
  type EditorRatio,
  type EditorScene,
  type EditorShot,
  type EditorSource,
} from "./editorState";
import { subjectCentre } from "@/lib/mobile/shotFraming";
import { CapabilityNotice, ServerBadge, useStudioCapability } from "./StudioChrome";
import { BriefPanel } from "./BriefPanel";
import { SourcePicker } from "./SourcePicker";
import { prepareClip } from "./clipPreview";
import { buildRenderTimeline } from "./renderTimeline";
import { SubmitMedia } from "./SubmitMedia";
import { SceneList, type StoryboardApproval } from "./SceneList";
import { AudioPanel, type ScriptStatus, type VoiceStatus } from "./AudioPanel";
import { StylePanel } from "./StylePanel";
import { RenderPanel, type MainVideoControls } from "./RenderPanel";
import { ChannelsPanel, channelShapes } from "./ChannelsPanel";
import {
  approveStudioContent,
  approveStudioProduction,
  approveStudioVideo,
  approveStudioVoice,
  fetchStudioContent,
  fetchStudioFraming,
  generateStudioChannels,
  regenerateStudioVoice,
  restoreStudioSources,
  submitStudioRequest,
  type StudioContent,
  type StudioScript,
} from "./studioPipeline";

/**
 * The phone video editor.
 *
 * TWO MODES, NEVER CONFUSED. Without a `requestId` this is a DRAFT tool: it
 * renders on the phone and nothing it produces touches a job, a channel or a
 * credit. With one, it can also take that request's queued render step, and
 * everything then goes through the server's lease, verification and completion.
 * The distinction is stated on screen rather than left to be inferred from
 * which buttons happen to be enabled.
 *
 * WHY THE ACTION BAR IS FIXED. The primary action has to be reachable without
 * scrolling past a long timeline, and a thumb reaches the bottom of a phone far
 * more easily than the top. The bar sits above the home indicator, which is why
 * the layout carries a safe-area inset rather than a fixed padding.
 */

export interface MobileVideoEditorProps {
  /** When present, the editor can also render this request's queued step. */
  requestId?: string | null;
  /** Shown in the header so a tester knows which video they are looking at. */
  requestLabel?: string | null;
  /**
   * The saved request's brief, when the studio is opened on one. Loaded on the
   * server so reopening a request shows what was typed, rather than an empty
   * form that would overwrite it on the next save.
   */
  initialBrief?: EditorBrief | null;
}

type Step = "brief" | "source" | "scenes" | "audio" | "style" | "render" | "channels";

// The order is the order the decisions actually depend on each other: what the
// video is for, what there is to work with, what the plan is, then the craft.
// "scenes" is labelled Storyboard: it is where the pipeline's plan lands and
// where it is rearranged, shot by shot. "style" is labelled Graphic: the Look
// (captions' languages are chosen in Sound, with the background track). After
// the main video is rendered and approved, Channels makes the other shapes.
const STEPS: { id: Step; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "source", label: "Media" },
  { id: "scenes", label: "Storyboard" },
  { id: "audio", label: "Sound" },
  { id: "style", label: "Graphic" },
  { id: "render", label: "Render" },
  { id: "channels", label: "Channels" },
];

// Steps at or past the main video's approval.
const AFTER_MAIN_APPROVAL: string[] = [
  VideoGenerationStep.AwaitingAdditionalRatios,
  VideoGenerationStep.GeneratingAdditionalRatios,
  VideoGenerationStep.AwaitingDistributionReview,
  VideoGenerationStep.Publishing,
  VideoGenerationStep.Complete,
];

/**
 * Travy is not offered in the studio for now: its export is made from
 * server-held masters, which a phone-rendered request does not have.
 */
function withoutTravy(platforms: Platform[]): Platform[] {
  return platforms.filter((platform) => platform !== Platform.TravyApp);
}

export default function MobileVideoEditor({
  requestId: initialRequestId,
  requestLabel,
  initialBrief,
}: MobileVideoEditorProps) {
  const [step, setStep] = useState<Step>("brief");
  const [document, setDocument] = useState<EditorDocument>(() => {
    const fresh = emptyDocument();
    return initialBrief
      ? { ...fresh, brief: { ...initialBrief, platforms: withoutTravy(initialBrief.platforms) } }
      : fresh;
  });
  // The request this studio works against. It starts as whatever the page was
  // opened with and becomes the new id the moment the brief is saved — the
  // studio attaches to the request in place instead of navigating away.
  const [requestId, setRequestId] = useState<string | null>(initialRequestId ?? null);
  const [availability, setAvailability] = useState<DeviceRenderAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DeviceRenderProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverOutcome, setServerOutcome] = useState<string | null>(null);
  // ── the pipeline, once the media is submitted ──
  const [content, setContent] = useState<StudioContent | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [script, setScript] = useState<StudioScript | null>(null);
  const [voiceId, setVoiceId] = useState<ElevenLabsVoiceId>(DEFAULT_ELEVENLABS_VOICE_ID);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [sendingProduction, setSendingProduction] = useState(false);
  // Sound and Graphic are each confirmed with a button at the bottom of the
  // step. Changing a choice there takes the confirmation back.
  const [soundConfirmed, setSoundConfirmed] = useState(false);
  const [graphicConfirmed, setGraphicConfirmed] = useState(false);
  const [videoApproving, setVideoApproving] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  // Channels: the extra shapes chosen, and the call that starts them.
  const [channelChoice, setChannelChoice] = useState<string[] | null>(null);
  const [channelsStarting, setChannelsStarting] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  // The storyboard the person approved, by identity. Any edit makes a new
  // scenes array, so "approved" quietly lapses the moment it is changed — an
  // approval of a storyboard that no longer exists is not an approval.
  const [approvedScenes, setApprovedScenes] = useState<EditorScene[] | null>(null);
  const productionSending = useRef(false);
  // Set by Stop, cleared by tapping Render: stops the automatic render from
  // restarting the moment it was stopped.
  const userStopped = useRef(false);
  // The job storyboard is applied to the timeline ONCE. After that the timeline
  // is the person's, and a poll that re-applied it would undo their edits.
  const storyboardApplied = useRef(false);

  const capability = useStudioCapability();
  const nativeReady = capability?.canRender === true;

  const cancelRequested = useRef(false);

  // ── what the server would hand this phone ─────────────────────────────────
  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    const poll = async () => {
      const result = await checkDeviceRenderAvailability(requestId);
      if (!cancelled) setAvailability(result);
    };
    void poll();
    // Slow on purpose: the answer changes when an approval gate clears, which is
    // a human-speed event. A tight poll would be a request a second for as long
    // as the screen is open.
    const timer = setInterval(() => void poll(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [requestId]);

  const problems = useMemo(() => validateDocument(document), [document]);
  const totalSeconds = useMemo(() => documentDurationSeconds(document), [document]);

  const update = useCallback((change: (current: EditorDocument) => EditorDocument) => {
    setDocument(change);
  }, []);

  const patchBrief = useCallback((change: Partial<EditorBrief>) => {
    setDocument((current) => ({ ...current, brief: { ...current.brief, ...change } }));
  }, []);

  /**
   * The brief was written to the database; attach to that request.
   *
   * The address bar is updated with `replaceState` rather than a navigation:
   * a router push would re-run the server page and remount nothing useful,
   * while losing none of the in-memory media is the entire point. The URL only
   * has to be right so that a reload, or reopening the app, lands on the same
   * request.
   */
  const attachRequest = useCallback((id: string) => {
    setRequestId(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("request", id);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // A URL that could not be rewritten costs a reload's worth of context,
      // not the request — the id is already held in state.
    }
    setMessage("Request saved. Now add your photos and clips.");
    // Saving the brief is the end of that step; the next thing to do is the
    // media, so go there rather than leaving the person to find it.
    setStep("source");
  }, []);

  // ── media ─────────────────────────────────────────────────────────────────
  const addFiles = useCallback(
    async (files: FileList | null) => {
      setError(null);
      const picked = Array.from(files ?? []).slice(0, 20);
      if (picked.length === 0) return;

      // One file that will not open must not lose the others, so each is
      // prepared on its own and the ones that failed are named at the end.
      const added: EditorSource[] = [];
      const notes: string[] = [];
      const failures: string[] = [];
      for (const file of picked) {
        const isClip = file.type.startsWith("video/");
        try {
          // One decode per file, producing the length, the frame shown in
          // every grid from here on, and — for a clip the in-app browser cannot
          // play — a preview copy made by the phone's own video engine. A photo
          // is downscaled: the tile and the storyboard frame should not be
          // carrying a six-megabyte original around.
          const prepared = isClip
            ? await prepareClip(file)
            : {
                durationSeconds: null,
                posterUrl: await readImagePoster(file),
                previewUrl: URL.createObjectURL(file),
                note: null,
              };
          if (prepared.note) notes.push(prepared.note);
          added.push({
            id: nextId("src"),
            kind: isClip ? "clip" : "image",
            file,
            previewUrl: prepared.previewUrl,
            posterUrl: prepared.posterUrl,
            durationSeconds: prepared.durationSeconds,
            fileName: file.name,
          });
        } catch (failure) {
          failures.push(failure instanceof Error ? failure.message : `${file.name} could not be read.`);
        }
      }

      if (added.length > 0) {
        update((current) => {
          const sources = [...current.sources, ...added];
          return {
            ...current,
            sources,
            // Auto-arrange only the first time, so adding a photo later does not
            // throw away an order someone has already set.
            scenes: current.scenes.length === 0 ? autoArrange(sources) : current.scenes,
          };
        });
        setMessage(
          [`${added.length} item(s) added. Originals stay on this phone.`, ...notes].join(" ")
        );
      }
      if (failures.length > 0) setError(failures.join(" "));
    },
    [update]
  );

  const removeSource = useCallback(
    (sourceId: string) => {
      update((current) => {
        const source = findSource(current, sourceId);
        if (source) {
          URL.revokeObjectURL(source.previewUrl);
          // The poster is a second object URL of its own; leaving it behind
          // holds the decoded frame for as long as the page is open.
          if (source.posterUrl) URL.revokeObjectURL(source.posterUrl);
        }
        return {
          ...current,
          sources: current.sources.filter((item) => item.id !== sourceId),
          scenes: current.scenes.map((scene) => ({
            ...scene,
            shots: scene.shots.filter((shot) => shot.sourceId !== sourceId),
          })),
        };
      });
    },
    [update]
  );

  // ── timeline ──────────────────────────────────────────────────────────────
  const patchShot = useCallback(
    (sceneId: string, shotId: string, change: Partial<EditorShot>) => {
      update((current) => ({
        ...current,
        scenes: current.scenes.map((scene) =>
          scene.id !== sceneId
            ? scene
            : {
                ...scene,
                shots: scene.shots.map((shot) =>
                  shot.id === shotId ? { ...shot, ...change } : shot
                ),
              }
        ),
      }));
    },
    [update]
  );

  const moveShot = useCallback(
    (sceneId: string, index: number, by: -1 | 1) => {
      update((current) => ({
        ...current,
        scenes: current.scenes.map((scene) => {
          if (scene.id !== sceneId) return scene;
          const target = index + by;
          if (target < 0 || target >= scene.shots.length) return scene;
          const shots = [...scene.shots];
          [shots[index], shots[target]] = [shots[target], shots[index]];
          return { ...scene, shots };
        }),
      }));
    },
    [update]
  );

  const removeShot = useCallback(
    (sceneId: string, shotId: string) => {
      update((current) => ({
        ...current,
        scenes: current.scenes
          .map((scene) =>
            scene.id !== sceneId
              ? scene
              : { ...scene, shots: scene.shots.filter((shot) => shot.id !== shotId) }
          )
          // A scene with nothing in it renders nothing, so it is dropped rather
          // than left as an empty row someone has to tidy up.
          .filter((scene) => scene.shots.length > 0),
      }));
    },
    [update]
  );

  const addScene = useCallback(() => {
    update((current) => ({
      ...current,
      scenes: [
        ...current.scenes,
        { id: nextId("scene"), transitionIn: "fade", summary: "", shots: [] },
      ],
    }));
  }, [update]);

  const addShotToScene = useCallback(
    (sceneId: string, sourceId: string) => {
      update((current) => {
        const source = findSource(current, sourceId);
        if (!source) return current;
        const clipLength = source.durationSeconds ?? 0;
        const duration =
          source.kind === "clip" && clipLength > 0 ? Math.min(3, Math.max(0.5, clipLength)) : 3;
        return {
          ...current,
          scenes: current.scenes.map((scene) =>
            scene.id !== sceneId
              ? scene
              : {
                  ...scene,
                  shots: [
                    ...scene.shots,
                    {
                      id: nextId("shot"),
                      sourceId,
                      durationSeconds: Math.round(duration * 10) / 10,
                      motion: source.kind === "clip" ? "static" : "ken_burns_in",
                      trimStartSeconds: 0,
                      trimEndSeconds:
                        source.kind === "clip" && clipLength > 0
                          ? Math.round(Math.min(clipLength, duration) * 10) / 10
                          : null,
                      focusX: 0.5,
                      focusY: 0.5,
                    } satisfies EditorShot,
                  ],
                }
          ),
        };
      });
    },
    [update]
  );

  const setSceneTransition = useCallback(
    (sceneId: string, transition: MontageTransition) => {
      update((current) => ({
        ...current,
        scenes: current.scenes.map((scene) =>
          scene.id === sceneId ? { ...scene, transitionIn: transition } : scene
        ),
      }));
    },
    [update]
  );

  const moveScene = useCallback(
    (index: number, by: -1 | 1) => {
      update((current) => {
        const target = index + by;
        if (target < 0 || target >= current.scenes.length) return current;
        const scenes = [...current.scenes];
        [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
        return { ...current, scenes };
      });
    },
    [update]
  );

  const removeScene = useCallback(
    (sceneId: string) => {
      update((current) => ({
        ...current,
        scenes: current.scenes.filter((scene) => scene.id !== sceneId),
      }));
    },
    [update]
  );

  const setSceneSummary = useCallback(
    (sceneId: string, summary: string) => {
      update((current) => ({
        ...current,
        scenes: current.scenes.map((scene) =>
          scene.id === sceneId ? { ...scene, summary } : scene
        ),
      }));
    },
    [update]
  );

  /**
   * Use a piece of material in a scene, or stop using it there.
   *
   * Turning it off removes every shot of it from that scene; the scene itself
   * stays, empty, so the person can pick something else for it rather than
   * losing the scene and its sentence along with the picture.
   */
  const toggleSource = useCallback(
    (sceneId: string, sourceId: string) => {
      const scene = document.scenes.find((entry) => entry.id === sceneId);
      if (!scene) return;
      if (scene.shots.some((shot) => shot.sourceId === sourceId)) {
        update((current) => ({
          ...current,
          scenes: current.scenes.map((entry) =>
            entry.id !== sceneId
              ? entry
              : { ...entry, shots: entry.shots.filter((shot) => shot.sourceId !== sourceId) }
          ),
        }));
      } else {
        addShotToScene(sceneId, sourceId);
      }
    },
    [addShotToScene, document.scenes, update]
  );

  // ── the pipeline: submit, follow, approve ─────────────────────────────────
  const submitted = Boolean(content?.submitted);
  const analysing =
    submitted &&
    (!content?.jobId || content.currentStep === VideoGenerationStep.AnalyzingContent);
  const analysisFailed =
    content?.currentStep === VideoGenerationStep.Failed &&
    content.failedAtStep === VideoGenerationStep.AnalyzingContent;
  const contentApproved = Boolean(content?.contentApproved);

  /**
   * Does this editor source correspond to that device-held original?
   *
   * A source picked in this session has an editor id; the original it was
   * copied to is named `<requestId>--<editor id>` (see `retainLocalFile`). A
   * source restored from storage after a reload IS named by its localId. Both
   * have to resolve, or a reopened studio would lose its storyboard.
   */
  const matchesLocal = useCallback(
    (sourceId: string, localId: string | undefined) =>
      Boolean(localId) &&
      (sourceId === localId ||
        `${requestId}--${sourceId}`.replace(/[^a-zA-Z0-9._-]/g, "_") === localId),
    [requestId]
  );

  // The pipeline's asset indexes count the SUBMITTED material list, not the
  // grid; these two translate between them.
  const materialOrder = useMemo(() => content?.localMedia ?? [], [content]);
  const indexOfSource = useCallback(
    (sourceId: string) =>
      materialOrder.length > 0
        ? materialOrder.findIndex((descriptor) => matchesLocal(sourceId, descriptor.localId))
        : document.sources.findIndex((source) => source.id === sourceId),
    [document.sources, matchesLocal, materialOrder]
  );

  const refreshContent = useCallback(async () => {
    if (!requestId) return;
    try {
      setContent(await fetchStudioContent(requestId));
    } catch {
      // A missed poll is not news; the next one will say where things are.
    }
  }, [requestId]);

  // Read where the request is whenever the studio attaches to one — including
  // a studio reopened on a request that was submitted days ago.
  useEffect(() => {
    storyboardApplied.current = false;
    setContent(null);
    setScript(null);
    void refreshContent();
  }, [refreshContent]);

  // Follow the job once it exists: quickly while the storyboard and script are
  // being written, slowly afterwards so the voice's progress still shows.
  useEffect(() => {
    if (!requestId || !submitted) return;
    const timer = setInterval(() => void refreshContent(), analysing ? 4_000 : 15_000);
    return () => clearInterval(timer);
  }, [analysing, refreshContent, requestId, submitted]);

  // A reopened studio has no picked files in memory. The originals it kept at
  // submission are still in private storage; bring them back so the storyboard
  // has pictures to point at.
  const restoring = useRef(false);
  useEffect(() => {
    if (!content?.submitted || content.localMedia.length === 0) return;
    if (document.sources.length > 0 || restoring.current) return;
    restoring.current = true;
    void restoreStudioSources(content.localMedia)
      .then(({ sources, missing }) => {
        if (sources.length > 0) setDocument((current) => ({ ...current, sources }));
        if (missing.length > 0) {
          setError(
            `These originals are no longer on this phone: ${missing.join(", ")}. This phone cannot render the request.`
          );
        }
      })
      .finally(() => {
        restoring.current = false;
      });
  }, [content, document.sources.length]);

  // When the pipeline's storyboard arrives, it becomes the timeline — once.
  useEffect(() => {
    if (!content?.storyboard || storyboardApplied.current) return;
    if (document.sources.length === 0) return;
    const plan = content.storyboard;
    const order = content.localMedia;
    storyboardApplied.current = true;
    update((current) => ({
      ...current,
      scenes: scenesFromStoryboard(current, plan, (assetIndex) =>
        order.length > 0
          ? current.sources.find((source) => matchesLocal(source.id, order[assetIndex]?.localId))
          : current.sources[assetIndex]
      ),
    }));
    setMessage(
      contentApproved
        ? "This is the storyboard approved with the script."
        : "Your storyboard is ready. Rearrange it here, then approve the script in Sound."
    );
  }, [content, contentApproved, document.sources.length, matchesLocal, update]);

  // Every picture's shape, read once from its poster: it is what decides how
  // much of a tall clip a wide video can show (see shotFraming.ts).
  useEffect(() => {
    const unmeasured = document.sources.filter(
      (source) => source.aspect === undefined && (source.posterUrl || source.kind === "image")
    );
    if (unmeasured.length === 0) return;
    let cancelled = false;
    void Promise.all(
      unmeasured.map(async (source) => ({
        id: source.id,
        aspect: await measurePictureAspect(source.posterUrl ?? source.previewUrl),
      }))
    ).then((measured) => {
      if (cancelled) return;
      const byId = new Map(measured.map((entry) => [entry.id, entry.aspect]));
      setDocument((current) => ({
        ...current,
        sources: current.sources.map((source) =>
          byId.has(source.id) ? { ...source, aspect: byId.get(source.id) ?? null } : source
        ),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [document.sources]);

  // Once the storyboard is here, ask where the subject is in each picture —
  // once per request — and frame every shot nobody has framed by hand on it.
  const framingAsked = useRef<string | null>(null);
  useEffect(() => {
    if (!requestId || !content?.storyboard) return;
    if (document.sources.length === 0 || document.scenes.length === 0) return;
    if (framingAsked.current === requestId) return;
    framingAsked.current = requestId;
    const order = content.localMedia;
    void fetchStudioFraming(requestId).then((subjects) => {
      if (subjects.length === 0) return;
      setDocument((current) => {
        const subjectOf = new Map<string, NonNullable<(typeof subjects)[number]>>();
        subjects.forEach((subject, assetIndex) => {
          if (!subject) return;
          const source =
            order.length > 0
              ? current.sources.find((entry) => matchesLocal(entry.id, order[assetIndex]?.localId))
              : current.sources[assetIndex];
          if (source) subjectOf.set(source.id, subject);
        });
        if (subjectOf.size === 0) return current;
        return {
          ...current,
          sources: current.sources.map((source) =>
            subjectOf.has(source.id) ? { ...source, subject: subjectOf.get(source.id) } : source
          ),
          scenes: current.scenes.map((scene) => ({
            ...scene,
            shots: scene.shots.map((shot) => {
              const subject = subjectOf.get(shot.sourceId);
              const untouched =
                shot.frameZoom == null &&
                Math.abs(shot.focusX - 0.5) < 0.01 &&
                Math.abs(shot.focusY - 0.5) < 0.01;
              return subject && untouched ? { ...shot, ...subjectCentre(subject) } : shot;
            }),
          })),
        };
      });
    });
  }, [content, document.scenes.length, document.sources.length, matchesLocal, requestId]);

  // The script is the server's until the person starts editing it; once
  // approved, the server's copy is the truth again.
  useEffect(() => {
    if (!content?.script) return;
    setScript((current) => (current && !content.contentApproved ? current : content.script));
  }, [content]);

  const submitMedia = useCallback(async () => {
    if (!requestId) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitProgress(null);
    try {
      await submitStudioRequest({
        requestId,
        sources: document.sources,
        onProgress: (done, total) => setSubmitProgress({ done, total }),
      });
      await refreshContent();
      setStep("scenes");
      setMessage("Submitted. Your storyboard and speaking script are being written.");
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSubmitting(false);
      setSubmitProgress(null);
    }
  }, [document.sources, refreshContent, requestId]);

  const approveScript = useCallback(async () => {
    if (!requestId || !script) return;
    setApproving(true);
    setApproveError(null);
    try {
      await approveStudioContent({
        requestId,
        script,
        voiceId,
        storyboard: storyboardFromScenes(document.scenes, indexOfSource),
      });
      await refreshContent();
      setMessage("Script approved. The voice is being made from it.");
    } catch (failure) {
      setApproveError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setApproving(false);
    }
  }, [document.scenes, indexOfSource, refreshContent, requestId, script, voiceId]);

  const scriptStatus: ScriptStatus = !submitted
    ? "not_submitted"
    : analysisFailed
      ? "failed"
      : analysing
        ? "writing"
        : contentApproved
          ? "approved"
          : script
            ? "review"
            : "writing";

  // ── voice, production, and the storyboard's approval ─────────────────────
  const step_ = content?.currentStep ?? null;
  const PRE_PRODUCTION: (string | null)[] = [
    null,
    VideoGenerationStep.AnalyzingContent,
    VideoGenerationStep.AwaitingContentApproval,
    VideoGenerationStep.GeneratingVoice,
    VideoGenerationStep.AwaitingVoiceApproval,
    VideoGenerationStep.GeneratingSceneDesign,
    VideoGenerationStep.AwaitingSceneDesignApproval,
  ];
  const productionStarted =
    submitted && !PRE_PRODUCTION.includes(step_) && step_ !== VideoGenerationStep.Failed;
  const atDesignGate = step_ === VideoGenerationStep.AwaitingSceneDesignApproval;
  const voiceStatus: VoiceStatus =
    step_ === VideoGenerationStep.GeneratingVoice
      ? "generating"
      : step_ === VideoGenerationStep.AwaitingVoiceApproval
        ? "review"
        : content?.voice
          ? "approved"
          : "none";
  const voiceSeconds = content?.voice?.durationSeconds ?? null;
  const requiredSeconds = voiceSeconds != null ? minMontageTotalSeconds(voiceSeconds) : null;
  const storyboardSeconds = scenesPlaySeconds(document.scenes);
  const covered = requiredSeconds == null || storyboardSeconds + 1 / 30 >= requiredSeconds;
  const storyboardApproved = approvedScenes !== null && approvedScenes === document.scenes;
  const hasShots = document.scenes.some((scene) => scene.shots.length > 0);

  /**
   * The channels, primary first, ordered so the base video's shape is the one
   * chosen in Media. The server takes the FIRST channel's shape; Travy stays in
   * the list but is only moved to the front if nothing else matches.
   */
  const orderedPlatforms = useMemo<Platform[]>(() => {
    const list = withoutTravy(document.brief.platforms);
    const matchIndex = list.findIndex((platform) => PLATFORM_ASPECT_RATIOS[platform] === document.ratio);
    if (matchIndex > 0) list.unshift(...list.splice(matchIndex, 1));
    return list;
  }, [document.brief.platforms, document.ratio]);

  const approveVoice = useCallback(async () => {
    if (!requestId || !content?.jobId) return;
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      await approveStudioVoice({ requestId, jobId: content.jobId, platforms: orderedPlatforms });
      await refreshContent();
      setMessage("Voice approved. The scene design is being prepared for your storyboard.");
    } catch (failure) {
      setVoiceError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setVoiceBusy(false);
    }
  }, [content?.jobId, orderedPlatforms, refreshContent, requestId]);

  const regenerateVoice = useCallback(async () => {
    if (!requestId || !content?.jobId) return;
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      await regenerateStudioVoice({ requestId, jobId: content.jobId, voiceId });
      await refreshContent();
      setMessage("Making the voice again.");
    } catch (failure) {
      setVoiceError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setVoiceBusy(false);
    }
  }, [content?.jobId, refreshContent, requestId, voiceId]);

  /**
   * Send the storyboard — every shot, trim, move and transition — as the
   * production plan. Only possible at the scene-design gate, which is the one
   * point in the pipeline that takes a shot-level plan.
   */
  const sendProduction = useCallback(async () => {
    if (!requestId || !content?.jobId || productionSending.current) return;
    productionSending.current = true;
    setSendingProduction(true);
    setError(null);
    try {
      await approveStudioProduction({
        requestId,
        jobId: content.jobId,
        scenePlan: scenePlanFromScenes(document, indexOfSource),
        durationSeconds: Math.min(
          30,
          Math.max(5, Math.round(voiceSeconds ?? document.brief.targetSeconds))
        ),
        musicTrackId: document.musicTrackId,
        subtitleLanguages: document.captionLanguages,
        templateId: document.templateId,
      });
      setApprovedScenes(document.scenes);
      userStopped.current = false;
      await refreshContent();
      setStep("render");
      setMessage("Rendering the main video on this phone. Keep the app open.");
      // Ask now rather than wait for the next slow poll: the montage is queued
      // for this phone the moment the plan is accepted.
      setAvailability(await checkDeviceRenderAvailability(requestId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      productionSending.current = false;
      setSendingProduction(false);
    }
  }, [content?.jobId, document, indexOfSource, refreshContent, requestId, voiceSeconds]);

  /**
   * Approve the storyboard and move on to Sound. Approving never starts the
   * render: that is Render's own button, once Sound and Graphic are confirmed.
   */
  const approveStoryboard = useCallback(() => {
    setApprovedScenes(document.scenes);
    setStep("audio");
    setMessage(
      contentApproved
        ? "Storyboard approved. Now confirm the sound."
        : "Storyboard approved. Now check the speaking script — it is approved together with it."
    );
  }, [contentApproved, document.scenes]);

  const fitStoryboard = useCallback(
    (seconds: number) => {
      update((current) => ({
        ...current,
        scenes: retimeScenes(
          current.scenes,
          seconds,
          (sourceId) => findSource(current, sourceId)?.durationSeconds ?? null
        ),
      }));
    },
    [update]
  );

  const coverageHint = covered
    ? null
    : `The voice needs at least ${requiredSeconds?.toFixed(1)}s of picture — use Fit before rendering.`;
  const storyboardApproval: StoryboardApproval | null =
    !submitted || productionStarted || analysing
      ? null
      : storyboardApproved
        ? {
            label: "Approved — continue to Sound",
            hint: coverageHint ?? "Change anything here and it needs approving again.",
            disabled: false,
            busy: false,
          }
        : {
            label: "Approve the storyboard",
            hint:
              coverageHint ??
              (contentApproved
                ? "Next: confirm the sound."
                : "Next: the speaking script in Sound, approved together with this storyboard."),
            disabled: !hasShots,
            busy: false,
          };

  // ── the main video and the other channel shapes ──────────────────────────
  const primaryRatio =
    (orderedPlatforms[0] && PLATFORM_ASPECT_RATIOS[orderedPlatforms[0]]) || document.ratio;
  const outputs = useMemo(() => content?.outputs ?? [], [content]);
  const atVideoGate = step_ === VideoGenerationStep.AwaitingOverlayApproval;
  const mainApproved = step_ !== null && AFTER_MAIN_APPROVAL.includes(step_);
  const mainVideoOutput =
    atVideoGate || mainApproved
      ? outputs.find((output) => output.ratio === primaryRatio) ?? outputs[0] ?? null
      : null;
  const otherShapes = useMemo(
    () =>
      channelShapes(orderedPlatforms)
        .map((shape) => shape.ratio)
        .filter((ratio) => ratio !== primaryRatio),
    [orderedPlatforms, primaryRatio]
  );
  const selectedShapes = channelChoice ?? otherShapes;

  const startMainRender = useCallback(() => {
    if (!atDesignGate) return;
    void sendProduction();
  }, [atDesignGate, sendProduction]);

  const approveMainVideo = useCallback(async () => {
    if (!requestId || !content?.jobId) return;
    setVideoApproving(true);
    setVideoError(null);
    try {
      await approveStudioVideo({ requestId, jobId: content.jobId });
      await refreshContent();
      setStep("channels");
      setMessage(
        otherShapes.length > 0
          ? "Video approved. Choose the other channel shapes to make."
          : "Video approved. Your channels all use this shape, so it is ready."
      );
    } catch (failure) {
      setVideoError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setVideoApproving(false);
    }
  }, [content?.jobId, otherShapes.length, refreshContent, requestId]);

  const startChannels = useCallback(
    async (ratios: string[]) => {
      if (!requestId || !content?.jobId) return;
      setChannelsStarting(true);
      setChannelsError(null);
      try {
        await generateStudioChannels({ requestId, jobId: content.jobId, ratios });
        userStopped.current = false;
        await refreshContent();
        setAvailability(await checkDeviceRenderAvailability(requestId));
        setMessage(
          ratios.length > 0
            ? `Rendering ${ratios.join(", ")} on this phone. Keep the app open.`
            : "Done. Your video is ready."
        );
      } catch (failure) {
        setChannelsError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setChannelsStarting(false);
      }
    },
    [content?.jobId, refreshContent, requestId]
  );

  const renderChecklist = [
    { label: "Storyboard approved", done: storyboardApproved },
    {
      // The picture has to run at least as long as the voice-over plus the
      // short music intro and ending, or the end of the voice plays over black.
      label:
        requiredSeconds != null
          ? `Video is long enough for the voice-over (${storyboardSeconds.toFixed(1)}s — needs at least ${requiredSeconds.toFixed(1)}s)`
          : "Video is long enough for the voice-over (checked once the voice is made)",
      done: requiredSeconds != null && covered,
    },
    { label: "Script and voice approved", done: voiceStatus === "approved" },
    { label: "Sound confirmed", done: soundConfirmed },
    { label: "Look confirmed", done: graphicConfirmed },
    {
      // What the server does at this point is small: it records the edit plan
      // and the timed captions from the approved voice. No video is made there.
      label: atDesignGate
        ? "Edit plan ready — the video is made on this phone"
        : step_ === VideoGenerationStep.GeneratingSceneDesign
          ? "Getting the edit plan ready (a few seconds)…"
          : "Edit plan — ready once the voice is approved",
      done: atDesignGate,
    },
  ];

  // ── live progress while the phone makes the video ─────────────────────────
  const timeline = productionStarted
    ? buildRenderTimeline({
        pipelineStep: step_,
        busy,
        progress,
        paused: userStopped.current,
        workAvailable: Boolean(availability?.available),
      })
    : null;
  const [renderStartedAt, setRenderStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (busy && renderStartedAt === null) setRenderStartedAt(Date.now());
  }, [busy, renderStartedAt]);
  const ticking = Boolean(timeline && !timeline.finished && renderStartedAt !== null);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);
  const elapsed =
    renderStartedAt !== null && timeline && !timeline.finished
      ? formatElapsed(now - renderStartedAt)
      : null;

  // The same clock for the channel shapes, restarted when they begin.
  const [shapesStartedAt, setShapesStartedAt] = useState<number | null>(null);
  const shapesRendering = step_ === VideoGenerationStep.GeneratingAdditionalRatios;
  useEffect(() => {
    if (shapesRendering && shapesStartedAt === null) setShapesStartedAt(Date.now());
    if (!shapesRendering && shapesStartedAt !== null) setShapesStartedAt(null);
  }, [shapesRendering, shapesStartedAt]);
  useEffect(() => {
    if (!shapesRendering) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [shapesRendering]);
  const elapsedAny = shapesStartedAt !== null ? formatElapsed(now - shapesStartedAt) : null;

  const mainControls: MainVideoControls | null = requestId
    ? {
        checklist: renderChecklist,
        productionStarted,
        starting: sendingProduction,
        onStart: startMainRender,
        video: mainVideoOutput
          ? { url: mainVideoOutput.url, ratio: mainVideoOutput.ratio, madeOn: mainVideoOutput.madeOn }
          : null,
        awaitingApproval: atVideoGate,
        approved: mainApproved,
        approving: videoApproving,
        onApprove: () => void approveMainVideo(),
        error: videoError,
        timeline,
        elapsed,
      }
    : null;

  // ── rendering ─────────────────────────────────────────────────────────────
  const renderForServer = useCallback(async () => {
    if (!requestId) return;
    setBusy(true);
    setError(null);
    setServerOutcome(null);
    cancelRequested.current = false;
    setStep("render");

    try {
      // The originals this phone kept at submission. Without them a
      // local-first manifest has nothing to stage and every render would fail.
      const localMedia = await loadLocalMediaIndex();
      let outcome = await runDeviceRender({
        requestId,
        localMedia,
        onProgress: setProgress,
        shouldCancel: () => cancelRequested.current,
      });
      // A montage is one task per scene, then the master and the final. Keep
      // going while the server has more for this phone, so one tap renders the
      // whole video rather than one piece of it.
      let completed = 0;
      while (outcome.status === "completed" && !cancelRequested.current && completed < 24) {
        completed += 1;
        const next = await checkDeviceRenderAvailability(requestId);
        setAvailability(next);
        if (!next.available) break;
        outcome = await runDeviceRender({
          requestId,
          localMedia,
          onProgress: setProgress,
          shouldCancel: () => cancelRequested.current,
        });
      }
      void refreshContent();

      // Anything but a clean finish pauses the automatic render until Render is
      // tapped. Otherwise a step the phone cannot take yet (its inputs are not
      // ready, say) would be offered, refused and re-offered in a tight loop
      // for as long as the screen is open.
      if (outcome.status !== "completed") userStopped.current = true;

      if (outcome.status === "completed" || (completed > 0 && outcome.status === "refused")) {
        setServerOutcome(
          `Done — ${Math.max(1, completed)} part(s) rendered on this phone and checked by the server.`
        );
      } else if (outcome.status === "refused") {
        setServerOutcome(explainRefusal(outcome.reason));
      } else if (outcome.status === "released") {
        // The step goes back in the queue — for THIS phone. Nothing else holds
        // the originals, so no server will pick it up in the meantime.
        setServerOutcome("Stopped. Tap Render to carry on — this video is rendered on this phone only.");
      } else {
        setServerOutcome(
          `This phone could not finish this part (${outcome.reason ?? "unknown"}). Keep the app open and tap Render to try again.`
        );
      }
      setAvailability(await checkDeviceRenderAvailability(requestId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [refreshContent, requestId]);

  const cancel = useCallback(async () => {
    cancelRequested.current = true;
    userStopped.current = true;
    await cancelDeviceRender();
    setMessage("Stopping…");
  }, []);

  /**
   * Render without being asked, once production has handed this phone work.
   *
   * A studio request's render steps are queued for this phone alone — the
   * server and the Mac Mini have no copy of the originals — so a phone that
   * waited to be told would be a video that waits forever. The same rule
   * `DeviceRenderRunner` follows on the request page. Pressing Stop turns it
   * off until Render is tapped again.
   */
  useEffect(() => {
    if (!availability?.available || busy || !nativeReady) return;
    if (!productionStarted || userStopped.current) return;
    void renderForServer();
  }, [availability, busy, nativeReady, productionStarted, renderForServer]);

  // ── step completion, for the rail's ticks ─────────────────────────────────
  const stepDone: Record<Step, boolean> = {
    brief: Boolean(requestId),
    source: submitted,
    scenes: storyboardApproved || productionStarted,
    audio: soundConfirmed || productionStarted,
    style: graphicConfirmed || productionStarted,
    render: mainApproved,
    channels:
      step_ === VideoGenerationStep.AwaitingDistributionReview ||
      step_ === VideoGenerationStep.Complete,
  };

  const mediaProblems = submissionProblems(document.sources);
  // The bar is for Stop while rendering, and for picking a stopped render back
  // up. Starting the main video is Render's own button.
  const showActions =
    busy || Boolean(requestId && productionStarted && availability?.available);

  return (
    <main className="studio">
      <header className="studio-header">
        <ServerBadge />
        <h1 className="studio-title">{requestLabel ?? "Video studio"}</h1>
        <p className="studio-subtitle">
          {requestId
            ? "Edit and render this request on your phone. Approvals, credits and publishing stay on the server."
            : "A draft tool. Nothing here submits a request, spends credits or publishes anything."}
        </p>
      </header>

      <nav className="studio-steps" aria-label="Editing steps">
        {STEPS.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            className={`studio-step${stepDone[entry.id] ? " studio-step-done" : ""}`}
            aria-current={step === entry.id ? "step" : undefined}
            onClick={() => setStep(entry.id)}
          >
            <span className="studio-step-index" aria-hidden>
              {stepDone[entry.id] ? "✓" : index + 1}
            </span>
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="studio-body">
        <CapabilityNotice capability={capability} />

        {step === "brief" && (
          <BriefPanel
            brief={document.brief}
            requestId={requestId}
            onChange={patchBrief}
            onRequestSaved={attachRequest}
            disabled={busy}
          />
        )}

        {step === "source" && (
          <SourcePicker
            sources={document.sources}
            ratio={document.ratio}
            onAdd={addFiles}
            onRemove={removeSource}
            onRatioChange={(ratio: EditorRatio) => update((current) => ({ ...current, ratio }))}
            disabled={busy || submitting}
            locked={submitted}
            footer={
              document.sources.length > 0 ? (
                <SubmitMedia
                  hasRequest={Boolean(requestId)}
                  submitted={submitted}
                  problems={mediaProblems}
                  confirmed={confirmed}
                  submitting={submitting}
                  progress={submitProgress}
                  error={submitError}
                  onConfirm={setConfirmed}
                  onSubmit={() => void submitMedia()}
                  onGoToBrief={() => setStep("brief")}
                  disabled={busy}
                />
              ) : null
            }
          />
        )}

        {step === "scenes" && (
          <SceneList
            document={document}
            transitions={MONTAGE_TRANSITIONS}
            motions={MOTION_PRESETS as MotionPreset[]}
            onPatchShot={patchShot}
            onMoveShot={moveShot}
            onRemoveShot={removeShot}
            onAddScene={addScene}
            onToggleSource={toggleSource}
            onSceneTransition={setSceneTransition}
            onMoveScene={moveScene}
            onRemoveScene={removeScene}
            onSceneSummary={setSceneSummary}
            onFit={fitStoryboard}
            targetSeconds={document.brief.targetSeconds}
            requiredSeconds={requiredSeconds}
            approval={storyboardApproval}
            onApprove={approveStoryboard}
            planning={analysing && !content?.storyboard}
            planError={
              analysisFailed
                ? "The storyboard could not be written. Open the request from your request list to retry it."
                : null
            }
            lockedNote={
              productionStarted
                ? "In production. This storyboard is what is being rendered, so it can no longer be changed here."
                : null
            }
            disabled={busy || productionStarted || sendingProduction}
          />
        )}

        {step === "audio" && (
          <AudioPanel
            document={document}
            tracks={BACKGROUND_MUSIC_TRACKS}
            onMusicTrack={(trackId) => {
              setSoundConfirmed(false);
              update((current) => ({ ...current, musicTrackId: trackId }));
            }}
            scriptStatus={scriptStatus}
            script={script}
            currentStep={content?.currentStep ?? null}
            onScriptChange={(change) =>
              setScript((current) => (current ? { ...current, ...change } : current))
            }
            voiceId={voiceId}
            onVoice={setVoiceId}
            onApprove={() => void approveScript()}
            approving={approving}
            approveError={approveError}
            voiceStatus={voiceStatus}
            voiceUrl={content?.voice?.url ?? null}
            voiceSeconds={voiceSeconds}
            onApproveVoice={() => void approveVoice()}
            onRegenerateVoice={() => void regenerateVoice()}
            voiceBusy={voiceBusy}
            voiceError={voiceError}
            onLanguages={(languages: CaptionLanguage[]) => {
              setSoundConfirmed(false);
              update((current) => ({ ...current, captionLanguages: languages }));
            }}
            soundConfirmed={soundConfirmed}
            onConfirm={() => {
              setSoundConfirmed(true);
              setStep("style");
              setMessage("Sound confirmed. Now choose the look.");
            }}
            confirmBlocker={
              productionStarted || voiceStatus === "approved"
                ? null
                : scriptStatus === "review"
                  ? "Approve the script first, then the voice."
                  : voiceStatus === "review"
                    ? "Listen to the voice and approve it first."
                    : "The voice has to be made and approved first."
            }
            locked={productionStarted}
            disabled={busy}
          />
        )}

        {step === "style" && (
          <StylePanel
            document={document}
            templates={MOTION_TEMPLATES}
            ratio={primaryRatio}
            onTemplate={(templateId) => {
              setGraphicConfirmed(false);
              update((current) => ({ ...current, templateId }));
            }}
            graphicConfirmed={graphicConfirmed}
            onConfirm={() => {
              setGraphicConfirmed(true);
              setStep("render");
              setMessage("Look confirmed. Render the main video when you are ready.");
            }}
            locked={productionStarted}
            disabled={busy}
          />
        )}

        {step === "render" && (
          <RenderPanel
            problems={problems}
            totalSeconds={totalSeconds}
            busy={busy}
            nativeReady={nativeReady}
            hasVoice={contentApproved}
            availability={availability}
            progress={progress}
            draft={null}
            serverOutcome={serverOutcome}
            pipelineStatus={
              step_ ? PIPELINE_STEP_DESCRIPTIONS[step_ as VideoGenerationStep] ?? null : null
            }
            main={mainControls}
          />
        )}

        {step === "channels" && (
          <ChannelsPanel
            platforms={orderedPlatforms}
            primaryRatio={primaryRatio}
            currentStep={step_}
            outputs={outputs}
            chain={content?.chain ?? null}
            selected={selectedShapes}
            onToggle={(ratio) =>
              setChannelChoice(
                selectedShapes.includes(ratio)
                  ? selectedShapes.filter((entry) => entry !== ratio)
                  : otherShapes.filter((entry) => entry === ratio || selectedShapes.includes(entry))
              )
            }
            onStart={() => void startChannels(selectedShapes)}
            onFinish={() => void startChannels([])}
            starting={channelsStarting}
            error={channelsError}
            busy={busy}
            progress={progress}
            elapsed={elapsedAny}
          />
        )}

        <div role="status" aria-live="polite" style={{ display: "grid", gap: 8 }}>
          {message && <p className="studio-note">{message}</p>}
          {error && <p className="studio-note studio-note-danger">{error}</p>}
        </div>
      </div>

      {showActions && (
        <div className="studio-actions">
          {busy ? (
            <button
              type="button"
              className="studio-button studio-button-ghost"
              onClick={() => void cancel()}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="studio-button studio-button-primary"
              disabled={!nativeReady}
              onClick={() => {
                userStopped.current = false;
                void renderForServer();
              }}
            >
              Resume rendering
              {availability?.ratio ? ` · ${availability.ratio}` : ""}
            </button>
          )}
        </div>
      )}
    </main>
  );
}

/** "1:05" for 65 seconds of work. */
function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

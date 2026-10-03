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
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
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
  DEFAULT_SHOT_SECONDS,
  shotFor,
  documentDurationSeconds,
  emptyDocument,
  findSource,
  nextId,
  measurePictureAspect,
  readImagePoster,
  retimeScenes,
  scenePlanFromScenes,
  scenesFromScenePlan,
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
import { STUDIO_MAX_DURATION_SECONDS } from "@/config/credits";
import {
  dropPrivateCopy,
  looksLikeHeic,
  PickedFileError,
  takePrivateCopy,
} from "./pickedFile";
import { CapabilityNotice, ServerBadge, useStudioCapability } from "./StudioChrome";
import { QuotaDialog, QuotaStatus, type StudioQuota } from "./QuotaPrompt";
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
  pipelineStepText,
  StudioI18nProvider,
  useStudioLocale,
  useStudioT,
  type StudioT,
} from "./studioI18n";
import {
  approveStudioContent,
  approveStudioProduction,
  approveStudioVideo,
  approveStudioVoice,
  fetchStudioContent,
  fetchStudioFraming,
  generateStudioChannels,
  regenerateStudioVoice,
  reopenStudioProduction,
  restoreStudioSources,
  submitStudioRequest,
  StudioQuotaError,
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
  /** The account's video allowance, read by the page; null when unknown. */
  quota?: StudioQuota | null;
}

type Step = "brief" | "source" | "scenes" | "audio" | "style" | "render" | "channels";

/** The step's name in the studio's language. */
function stepLabel(t: StudioT, step: Step): string {
  return t(`studio.step.${step}`);
}

// The order is the order the decisions actually depend on each other: what the
// video is for, what there is to work with, what the plan is, then the craft.
// "scenes" is labelled Storyboard: it is where the pipeline's plan lands and
// where it is rearranged, shot by shot. "style" is labelled Graphic: the Look
// (captions' languages are chosen in Sound, with the background track). After
// the main video is rendered and approved, Channels makes the other shapes.
const STEPS: { id: Step }[] = [
  { id: "brief" },
  { id: "source" },
  { id: "scenes" },
  { id: "audio" },
  { id: "style" },
  { id: "render" },
  { id: "channels" },
];

/**
 * Refusals that clear up by themselves within seconds: the next part is not
 * queued yet, the previous claim is still being closed, or the server is
 * still preparing inputs. Waiting and asking again is the right answer.
 */
const PASSING_REFUSALS = new Set([
  "no_render_queued",
  "already_rendering",
  "inputs_unavailable",
  "manifest_unavailable",
  "app_not_foreground",
]);

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

export default function MobileVideoEditor(props: MobileVideoEditorProps) {
  // The studio's words follow the language picked in the menu, else the
  // phone's own language (see studioI18n.tsx).
  return (
    <StudioI18nProvider>
      <StudioEditor {...props} />
    </StudioI18nProvider>
  );
}

function StudioEditor({
  requestId: initialRequestId,
  requestLabel,
  initialBrief,
  quota: initialQuota = null,
}: MobileVideoEditorProps) {
  const t = useStudioT();
  // The allowance as the page read it, updated when Submit is refused for it.
  const [quota, setQuota] = useState<StudioQuota | null>(initialQuota);
  const [quotaDialog, setQuotaDialog] = useState(false);
  const quotaRef = useRef<StudioQuota | null>(initialQuota);
  quotaRef.current = quota;
  // A fresh server render (router.refresh) brings a newer quota prop; take it.
  useEffect(() => {
    setQuota(initialQuota);
  }, [initialQuota]);
  // Re-read the allowance from the server. The page's quota is read once, and
  // coming back from Pricing after buying a package (back button, a Link, or
  // the app returning to the foreground) can show that cached page — which
  // still said "none left". Returns the fresh value, or null if unknown.
  const reloadQuota = useCallback(async (): Promise<StudioQuota | null> => {
    try {
      const res = await fetch("/api/video-packages/quota", { cache: "no-store" });
      if (!res.ok) return null;
      const fresh = (await res.json()) as StudioQuota;
      setQuota(fresh);
      if (fresh.canSubmit) setQuotaDialog(false);
      return fresh;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void reloadQuota();
    const onVisible = () => {
      if (window.document.visibilityState === "visible") void reloadQuota();
    };
    const onShow = () => void reloadQuota();
    window.addEventListener("focus", onShow);
    window.addEventListener("pageshow", onShow);
    window.document.addEventListener("visibilitychange", onVisible);
    // While the "none left" notice is up, keep checking: WKWebView does not
    // always fire focus/pageshow when the app comes back from Pricing.
    const poll = window.setInterval(() => {
      const blocked = quotaRef.current !== null && !quotaRef.current.canSubmit;
      if (blocked && window.document.visibilityState === "visible") void reloadQuota();
    }, 15_000);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("pageshow", onShow);
      window.document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadQuota]);
  const locale = useStudioLocale();
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
  const [progress, setProgressState] = useState<DeviceRenderProgress | null>(null);
  // Which part and shape the phone last reported, for naming a failure.
  const stageRef = useRef<string | null>(null);
  const ratioRef = useRef<string | null>(null);
  const setProgress = useCallback((next: DeviceRenderProgress | null) => {
    if (next?.stage) stageRef.current = next.stage;
    if (next?.ratio) ratioRef.current = next.ratio;
    setProgressState(next);
  }, []);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverOutcome, setServerOutcome] = useState<string | null>(null);
  // The latest failed try in THIS session, with its step-by-step log. The
  // server keeps a copy too (`lastPhoneError`), for a studio reopened later.
  const [renderFailure, setRenderFailure] = useState<
    { summary: string; log: string[]; stage: string | null; ratio: string | null } | null
  >(null);
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
  const [regenerating, setRegenerating] = useState(false);
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
  //
  // It STARTS set. A studio opened on a request whose video was already being
  // made — the app was closed mid-render and opened again — does not quietly
  // start encoding: it shows "Resume rendering" in Render and Channels, and the
  // person carries on when they are ready. Starting the main video, the channel
  // shapes or a regenerate in this session clears it, so those still run by
  // themselves from the first tap.
  const userStopped = useRef(true);
  // The studio lands on the step the request is at, once, when it is reopened.
  const landed = useRef(false);
  // The job storyboard is applied to the timeline ONCE. After that the timeline
  // is the person's, and a poll that re-applied it would undo their edits.
  const storyboardApplied = useRef(false);

  const capability = useStudioCapability();
  const nativeReady = capability?.canRender === true;

  const cancelRequested = useRef(false);

  // ── what the server would hand this phone ─────────────────────────────────
  // Slow (15 s) at human-speed gates; quick (4 s) while a video or an extra
  // shape is being made, when the next part is queued seconds after the last.
  const [pollFast, setPollFast] = useState(false);
  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    const poll = async () => {
      const result = await checkDeviceRenderAvailability(requestId);
      if (!cancelled) setAvailability(result);
    };
    void poll();
    const timer = setInterval(() => void poll(), pollFast ? 4_000 : 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollFast, requestId]);

  const problems = useMemo(() => validateDocument(document, t), [document, t]);
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
    setMessage(t("studio.msg.requestSaved"));
    // Saving the brief is the end of that step; the next thing to do is the
    // media, so go there rather than leaving the person to find it.
    setStep("source");
  }, [t]);

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
      for (const original of picked) {
        const isClip = original.type.startsWith("video/");
        const id = nextId("src");
        let snapshotKey: string | null = null;
        try {
          // A private copy FIRST, before anything decodes the file: the
          // gallery's reference can die at any moment after this (see
          // pickedFile.ts), and the copy is what everything below reads.
          const copy = await takePrivateCopy(`studio-${id}`, original, t);
          snapshotKey = copy.snapshotKey;
          const file = copy.file;
          // One decode per file, producing the length, the frame shown in
          // every grid from here on, and — for a clip the in-app browser cannot
          // play — a preview copy made by the phone's own video engine. A photo
          // is downscaled: the tile and the storyboard frame should not be
          // carrying a six-megabyte original around.
          const prepared = isClip
            ? await prepareClip(file, t)
            : {
                durationSeconds: null,
                posterUrl: await readImagePoster(file),
                previewUrl: URL.createObjectURL(file),
                note: null,
              };
          if (!isClip && !prepared.posterUrl) {
            // A photo this screen cannot draw would fail again at submit
            // (its preview cannot be made), so say why now and leave it out.
            URL.revokeObjectURL(prepared.previewUrl);
            throw new PickedFileError(
              (await looksLikeHeic(file))
                ? t("studio.msg.heic", { name: file.name })
                : t("studio.msg.notPicture", { name: file.name })
            );
          }
          if (prepared.note) notes.push(prepared.note);
          added.push({
            id,
            snapshotKey,
            kind: isClip ? "clip" : "image",
            file,
            previewUrl: prepared.previewUrl,
            posterUrl: prepared.posterUrl,
            durationSeconds: prepared.durationSeconds,
            fileName: file.name,
          });
        } catch (failure) {
          void dropPrivateCopy(snapshotKey);
          failures.push(
            failure instanceof PickedFileError
              ? failure.message
              : failure instanceof Error
                ? `${original.name}: ${failure.message}`
                : t("studio.msg.fileUnreadable", { name: original.name })
          );
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
          [t("studio.msg.itemsAdded", { count: added.length }), ...notes].join(" ")
        );
      }
      if (failures.length > 0) setError(failures.join(" "));
    },
    [t, update]
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
          void dropPrivateCopy(source.snapshotKey);
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

  const addScene = useCallback(() => {
    update((current) => ({
      ...current,
      scenes: [
        ...current.scenes,
        { id: nextId("scene"), transitionIn: "fade", summary: "", shots: [] },
      ],
    }));
  }, [update]);

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
  /**
   * Pick the scene's material. A scene holds ONE photo or clip, so picking
   * another replaces it (keeping the slot's length for a photo), and tapping
   * the one already there clears the scene.
   */
  const toggleSource = useCallback(
    (sceneId: string, sourceId: string) => {
      update((current) => {
        const source = findSource(current, sourceId);
        if (!source) return current;
        return {
          ...current,
          scenes: current.scenes.map((scene) => {
            if (scene.id !== sceneId) return scene;
            if (scene.shots.some((shot) => shot.sourceId === sourceId)) {
              return { ...scene, shots: [] };
            }
            const previous = scene.shots[0];
            return {
              ...scene,
              shots: [shotFor(source, "ken_burns_in", previous?.durationSeconds ?? DEFAULT_SHOT_SECONDS)],
            };
          }),
        };
      });
    },
    [update]
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

  // Reopened mid-production: go straight to where the video is being made, so
  // the Resume button (or the finished video and its download) is in view.
  useEffect(() => {
    if (landed.current || !content) return;
    landed.current = true;
    const at = content.currentStep;
    if (!content.submitted || !at) return;
    const inChannels =
      at === VideoGenerationStep.AwaitingAdditionalRatios ||
      at === VideoGenerationStep.GeneratingAdditionalRatios ||
      at === VideoGenerationStep.AwaitingDistributionReview ||
      at === VideoGenerationStep.Publishing ||
      at === VideoGenerationStep.Complete;
    const beforeProduction: string[] = [
      VideoGenerationStep.AnalyzingContent,
      VideoGenerationStep.AwaitingContentApproval,
      VideoGenerationStep.GeneratingVoice,
      VideoGenerationStep.AwaitingVoiceApproval,
      VideoGenerationStep.GeneratingSceneDesign,
      VideoGenerationStep.AwaitingSceneDesignApproval,
      VideoGenerationStep.Failed,
    ];
    if (inChannels) setStep("channels");
    else if (!beforeProduction.includes(at)) setStep("render");
  }, [content]);

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
          setError(t("studio.msg.originalsMissing", { names: missing.join(", ") }));
        }
      })
      .finally(() => {
        restoring.current = false;
      });
  }, [content, document.sources.length, t]);

  // When the pipeline's storyboard arrives, it becomes the timeline — once.
  // Once production has been started, the plan it was started with is the
  // timeline instead (trims, focus, zoom, moves), with the sound and look it
  // was made with, and all of it counts as approved — a reopened studio must
  // be able to remake the same video, not a default one.
  useEffect(() => {
    if (!content?.storyboard || storyboardApplied.current) return;
    if (document.sources.length === 0) return;
    const plan = content.storyboard;
    const order = content.localMedia;
    const sourceAt = (assetIndex: number) =>
      order.length > 0
        ? document.sources.find((source) => matchesLocal(source.id, order[assetIndex]?.localId))
        : document.sources[assetIndex];
    const production = content.production;
    const produced = production?.scenePlan
      ? scenesFromScenePlan(production.scenePlan, sourceAt)
      : [];
    if (produced.length > 0 && production) {
      storyboardApplied.current = true;
      setDocument((current) => ({
        ...current,
        scenes: produced,
        ...(production.musicTrackId
          ? { musicTrackId: production.musicTrackId === "none" ? null : production.musicTrackId }
          : {}),
        ...(production.subtitleLanguages.length > 0
          ? { captionLanguages: production.subtitleLanguages as typeof current.captionLanguages }
          : {}),
        ...(production.templateId ? { templateId: production.templateId } : {}),
      }));
      setApprovedScenes(produced);
      setSoundConfirmed(true);
      setGraphicConfirmed(true);
      return;
    }
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
        ? t("studio.msg.storyboardApprovedWithScript")
        : t("studio.msg.storyboardReady")
    );
  }, [content, contentApproved, document.sources, matchesLocal, t, update]);

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
    // Nothing left this period: say so, with the way to buy more, before any
    // original is copied or anything is sent.
    if (quota && !quota.canSubmit) {
      // Check again first: a package may have been bought since this was read.
      const fresh = await reloadQuota();
      if (!fresh || !fresh.canSubmit) {
        setQuotaDialog(true);
        return;
      }
    }
    setSubmitting(true);
    setSubmitError(null);
    setSubmitProgress(null);
    try {
      await submitStudioRequest({
        requestId,
        sources: document.sources,
        onProgress: (done, total) => setSubmitProgress({ done, total }),
        t,
      });
      await refreshContent();
      setStep("scenes");
      setMessage(t("studio.msg.submitted"));
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : String(failure));
      if (failure instanceof StudioQuotaError) {
        setQuota((current) => ({
          tier: current?.tier ?? "free",
          total: current?.total ?? 0,
          remaining: 0,
          canSubmit: false,
          renewsAt: failure.nextFreeSlotAt ?? current?.renewsAt ?? null,
        }));
        setQuotaDialog(true);
      }
    } finally {
      setSubmitting(false);
      setSubmitProgress(null);
    }
  }, [document.sources, quota, refreshContent, reloadQuota, requestId, t]);

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
        t,
      });
      await refreshContent();
      setMessage(t("studio.msg.scriptApproved"));
    } catch (failure) {
      setApproveError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setApproving(false);
    }
  }, [document.scenes, indexOfSource, refreshContent, requestId, script, t, voiceId]);

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
  // While the finished main video waits for review, the storyboard, sound and
  // look open up again: changing them and tapping "Regenerate the video" is
  // how a video is remade. Before that point, and once the video has been
  // taken on to Channels, what was sent is what is being made.
  const editLocked =
    productionStarted && step_ !== VideoGenerationStep.AwaitingOverlayApproval;
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
      await approveStudioVoice({ requestId, jobId: content.jobId, platforms: orderedPlatforms, t });
      await refreshContent();
      setMessage(t("studio.msg.voiceApproved"));
    } catch (failure) {
      setVoiceError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setVoiceBusy(false);
    }
  }, [content?.jobId, orderedPlatforms, refreshContent, requestId, t]);

  const regenerateVoice = useCallback(async () => {
    if (!requestId || !content?.jobId) return;
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      await regenerateStudioVoice({ requestId, jobId: content.jobId, voiceId, t });
      await refreshContent();
      setMessage(t("studio.msg.voiceAgain"));
    } catch (failure) {
      setVoiceError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setVoiceBusy(false);
    }
  }, [content?.jobId, refreshContent, requestId, t, voiceId]);

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
          STUDIO_MAX_DURATION_SECONDS,
          Math.max(5, Math.round(voiceSeconds ?? document.brief.targetSeconds))
        ),
        musicTrackId: document.musicTrackId,
        subtitleLanguages: document.captionLanguages,
        templateId: document.templateId,
        t,
      });
      setApprovedScenes(document.scenes);
      userStopped.current = false;
      await refreshContent();
      setStep("render");
      setMessage(t("studio.msg.renderingMain"));
      // Ask now rather than wait for the next slow poll: the montage is queued
      // for this phone the moment the plan is accepted.
      setAvailability(await checkDeviceRenderAvailability(requestId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      productionSending.current = false;
      setSendingProduction(false);
    }
  }, [content?.jobId, document, indexOfSource, refreshContent, requestId, t, voiceSeconds]);

  /**
   * Approve the storyboard and move on to Sound. Approving never starts the
   * render: that is Render's own button, once Sound and Graphic are confirmed.
   */
  const approveStoryboard = useCallback(() => {
    setApprovedScenes(document.scenes);
    setStep("audio");
    setMessage(
      contentApproved
        ? t("studio.msg.storyboardApprovedSound")
        : t("studio.msg.storyboardApprovedScript")
    );
  }, [contentApproved, document.scenes, t]);

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
    : t("studio.msg.coverage", { seconds: requiredSeconds?.toFixed(1) ?? "" });
  const storyboardApproval: StoryboardApproval | null =
    !submitted || editLocked || analysing
      ? null
      : storyboardApproved
        ? {
            label: t("studio.approval.approvedLabel"),
            hint: coverageHint ?? t("studio.approval.approvedHint"),
            disabled: false,
            busy: false,
          }
        : {
            label: t("studio.approval.label"),
            hint:
              coverageHint ??
              (contentApproved
                ? t("studio.approval.nextSound")
                : t("studio.approval.nextScript")),
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

  /**
   * Remake the main video from what the storyboard, Sound and Graphic say
   * NOW: reopen the scene-design gate on the server, then send the current
   * plan exactly as the first Render did. Only while the finished video is
   * waiting for review — once Channels has started from it, it is final.
   */
  const regenerateVideo = useCallback(async () => {
    if (!requestId || !content?.jobId) return;
    setRegenerating(true);
    setVideoError(null);
    try {
      await reopenStudioProduction({ requestId, jobId: content.jobId, t });
      await refreshContent();
      await sendProduction();
    } catch (failure) {
      setVideoError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRegenerating(false);
    }
  }, [content?.jobId, refreshContent, requestId, sendProduction, t]);

  const startChannels = useCallback(
    async (ratios: string[]) => {
      if (!requestId || !content?.jobId) return;
      const jobId = content.jobId;
      setChannelsStarting(true);
      setChannelsError(null);
      try {
        // Choosing the shapes IS taking the main video: there is no separate
        // Approve step any more. When every channel uses the main shape, the
        // server finishes right here and there is nothing more to start.
        let current = content.currentStep;
        if (current === VideoGenerationStep.AwaitingOverlayApproval) {
          await approveStudioVideo({ requestId, jobId, t });
          current = (await fetchStudioContent(requestId)).currentStep;
        }
        if (current === VideoGenerationStep.AwaitingAdditionalRatios) {
          await generateStudioChannels({ requestId, jobId, ratios, t });
        }
        userStopped.current = false;
        await refreshContent();
        setAvailability(await checkDeviceRenderAvailability(requestId));
        setMessage(
          ratios.length > 0 && current === VideoGenerationStep.AwaitingAdditionalRatios
            ? t("studio.msg.makingShapes", { ratios: ratios.join(", ") })
            : t("studio.msg.doneReady")
        );
      } catch (failure) {
        setChannelsError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setChannelsStarting(false);
      }
    },
    [content?.currentStep, content?.jobId, refreshContent, requestId, t]
  );

  const renderChecklist = [
    { label: t("studio.check.storyboard"), done: storyboardApproved },
    {
      // The picture has to run at least as long as the voice-over plus the
      // short music intro and ending, or the end of the voice plays over black.
      label:
        requiredSeconds != null
          ? t("studio.check.lengthKnown", {
              have: storyboardSeconds.toFixed(1),
              need: requiredSeconds.toFixed(1),
            })
          : t("studio.check.lengthUnknown"),
      done: requiredSeconds != null && covered,
    },
    { label: t("studio.check.voice"), done: voiceStatus === "approved" },
    { label: t("studio.check.sound"), done: soundConfirmed },
    { label: t("studio.check.look"), done: graphicConfirmed },
    {
      // What the server does at this point is small: it records the edit plan
      // and the timed captions from the approved voice. No video is made there.
      label: atDesignGate
        ? t("studio.check.planReady")
        : step_ === VideoGenerationStep.GeneratingSceneDesign
          ? t("studio.check.planMaking")
          : t("studio.check.planLater"),
      done: atDesignGate,
    },
  ];

  const phoneWorkExpected =
    productionStarted &&
    step_ !== VideoGenerationStep.AwaitingOverlayApproval &&
    step_ !== VideoGenerationStep.AwaitingAdditionalRatios &&
    step_ !== VideoGenerationStep.AwaitingDistributionReview &&
    step_ !== VideoGenerationStep.Publishing &&
    step_ !== VideoGenerationStep.Complete;
  useEffect(() => setPollFast(phoneWorkExpected), [phoneWorkExpected]);

  // What has to be true before the video can be remade: everything the first
  // Render needed, except the server gate, which regenerating reopens itself.
  const regenerateBlocker =
    renderChecklist.slice(0, -1).find((item) => !item.done)?.label ?? null;

  // ── live progress while the phone makes the video ─────────────────────────
  // Something this phone can carry on with: a queued part, or a part a closed
  // app was making whose claim is about to lapse.
  const resumable = Boolean(
    availability?.available || (availability?.resumeInSeconds ?? 0) > 0
  );
  const timeline = productionStarted
    ? buildRenderTimeline({
        pipelineStep: step_,
        t,
        busy,
        progress,
        paused: userStopped.current && resumable,
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


  // ── rendering ─────────────────────────────────────────────────────────────
  const renderForServer = useCallback(async () => {
    if (!requestId) return;
    setBusy(true);
    setError(null);
    setServerOutcome(null);
    cancelRequested.current = false;
    // No navigation here. This also runs by itself while the person is in
    // Channels (every extra shape is rendered through it), and pulling them
    // back to Render each time was the "it jumps back to Render" bug.

    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const run = () =>
      runDeviceRender({
        requestId,
        localMedia,
        onProgress: setProgress,
        shouldCancel: () => cancelRequested.current,
        t,
      });
    let localMedia: Awaited<ReturnType<typeof loadLocalMediaIndex>>;

    try {
      // The originals this phone kept at submission. Without them a
      // local-first manifest has nothing to stage and every render would fail.
      localMedia = await loadLocalMediaIndex();

      // ONE TAP (or none) RENDERS EVERYTHING. The video is several parts — the
      // picture, voice and music, look and captions, then each extra shape —
      // queued one after another, and the server needs a moment to queue the
      // next part after accepting one. The old loop asked once, and when the
      // next part was not queued YET it stopped; a refusal from that race was
      // treated like the person pressing Stop, which parked the render behind
      // a "Resume rendering" button. That was the endless Resume. Now:
      //   • a moment's wait for the next part is just a wait;
      //   • a passing refusal ("nothing queued yet", "already rendering") is
      //     retried after a short pause;
      //   • a failed part is retried twice before anything asks the person;
      //   • only Stop, or a refusal that will not change by waiting (an app
      //     build or phone that cannot do this), stops the chain.
      let outcome = await run();
      let completed = 0;
      let retries = 0;
      let waits = 0;
      for (;;) {
        if (outcome.status === "failed") {
          setRenderFailure({
            summary: outcome.reason ?? t("studio.render.noReason"),
            log: outcome.log ?? [],
            stage: stageRef.current,
            ratio: ratioRef.current,
          });
        } else if (outcome.status === "completed") {
          setRenderFailure(null);
        }
        if (cancelRequested.current) break;
        if (outcome.status === "completed") {
          completed += 1;
          retries = 0;
        } else if (outcome.status === "refused" && PASSING_REFUSALS.has(outcome.reason ?? "")) {
          if (++waits > 40) break;
          await pause(3_000);
        } else if (outcome.status === "failed" && retries < 1) {
          // ONE automatic retry. A part that fails the same way twice will fail
          // a third time too — the native renderer already falls back to hard
          // cuts and then to plain framing inside each try — and re-rendering
          // it again is what looked like the Picture part looping forever.
          retries += 1;
          setServerOutcome(
            t("studio.render.retrying", { reason: outcome.reason ?? t("studio.render.unknown") })
          );
          await pause(2_000);
        } else {
          break;
        }
        if (cancelRequested.current) break;

        // Is there another part for this phone? Give the server a few seconds
        // to queue it before deciding the video is done for now.
        // A part a closed app was making is held until its claim lapses
        // (`resumeInSeconds`); wait that out instead of giving up on Resume.
        let next = await checkDeviceRenderAvailability(requestId);
        let tries = 0;
        let lapseWaits = 0;
        while (!next.available && !cancelRequested.current) {
          if ((next.resumeInSeconds ?? 0) > 0 && lapseWaits < 40) {
            lapseWaits += 1;
            setServerOutcome(
              t("studio.render.pickingUp", { seconds: next.resumeInSeconds ?? 0 })
            );
            await pause(Math.min(5, next.resumeInSeconds!) * 1_000);
          } else if (tries < 5) {
            tries += 1;
            await pause(2_500);
          } else {
            break;
          }
          next = await checkDeviceRenderAvailability(requestId);
        }
        if (lapseWaits > 0) setServerOutcome(null);
        setAvailability(next);
        if (!next.available) break;
        outcome = await run();
      }
      void refreshContent();

      const stoppedByPerson = cancelRequested.current;
      const hardStop =
        outcome.status === "failed" ||
        (outcome.status === "refused" && !PASSING_REFUSALS.has(outcome.reason ?? ""));
      // Only the person's Stop, or something waiting cannot fix, parks the
      // automatic render behind "Resume rendering".
      userStopped.current = stoppedByPerson || hardStop;

      if (stoppedByPerson || outcome.status === "released") {
        setServerOutcome(t("studio.render.stopped"));
      } else if (outcome.status === "failed") {
        setServerOutcome(
          t("studio.render.failedTwice", { reason: outcome.reason ?? t("studio.render.unknown") })
        );
      } else if (hardStop) {
        setServerOutcome(explainRefusal(outcome.reason, t));
      } else if (completed > 0) {
        setServerOutcome(t("studio.render.partsMade", { count: completed }));
      }
      setAvailability(await checkDeviceRenderAvailability(requestId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [refreshContent, requestId, setProgress, t]);

  /**
   * Carry on after Stop, a failure, or the app being closed mid-render. Parts
   * already accepted by the server are kept; the one that was in progress is
   * made again from the start.
   */
  const resumeRender = useCallback(async () => {
    if (busy) return;
    userStopped.current = false;
    // After a reload the native renderer can still be busy with the render the
    // old page started; nobody is listening for it any more, so stop it first
    // or the new one is refused as "already active".
    await cancelDeviceRender();
    void renderForServer();
  }, [busy, renderForServer]);

  const cancel = useCallback(async () => {
    cancelRequested.current = true;
    userStopped.current = true;
    await cancelDeviceRender();
    setMessage(t("studio.editor.stopping"));
  }, [t]);

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
    scenes: storyboardApproved || editLocked,
    audio: soundConfirmed || editLocked,
    style: graphicConfirmed || editLocked,
    // Green as soon as the finished video is here — nothing to approve.
    render: mainApproved || (atVideoGate && mainVideoOutput != null),
    channels:
      step_ === VideoGenerationStep.AwaitingDistributionReview ||
      step_ === VideoGenerationStep.Complete,
  };

  const mediaProblems = submissionProblems(document.sources, t);
  // The bar is for Stop while rendering, and for picking a stopped render back
  // up. Starting the main video is Render's own button.
  // Stop while rendering; Resume only after Stop or a failure that waiting
  // cannot fix. Otherwise the render starts by itself and there is nothing to
  // press — a Resume button beside a render that is about to start anyway was
  // one of the buttons that never seemed to end.
  const canResume = Boolean(
    requestId && productionStarted && !busy && userStopped.current && resumable
  );
  const resumeControls = canResume
    ? {
        waitSeconds: availability?.available ? null : availability?.resumeInSeconds ?? null,
        disabled: !nativeReady,
        onResume: () => void resumeRender(),
      }
    : null;

  // Why the last try stopped: this session's, else the server's record of it.
  const PART_NAMES: Record<string, string> = {
    montage: t("studio.part.montage"),
    master: t("studio.part.master"),
    final: t("studio.part.final"),
  };
  const latestFailure = renderFailure
    ? renderFailure
    : content?.lastPhoneError
      ? {
          summary: content.lastPhoneError.reason,
          log: content.lastPhoneError.log ?? [],
          stage: content.lastPhoneError.stage,
          ratio: content.lastPhoneError.ratio,
        }
      : null;
  const describedFailure = latestFailure
    ? {
        summary:
          latestFailure.stage || latestFailure.ratio
            ? `${latestFailure.summary} (${
                PART_NAMES[latestFailure.stage ?? ""] ?? latestFailure.stage ?? t("studio.part.generic")
              }${latestFailure.ratio ? `, ${latestFailure.ratio}` : ""})`
            : latestFailure.summary,
        log: latestFailure.log,
        ratio: latestFailure.ratio,
      }
    : null;
  // The main video's failures show in Render; an extra shape's in Channels.
  const mainFailure =
    describedFailure && (!describedFailure.ratio || describedFailure.ratio === primaryRatio)
      ? describedFailure
      : null;
  const shapeFailure =
    describedFailure && describedFailure.ratio && describedFailure.ratio !== primaryRatio
      ? describedFailure
      : null;

  const mainControls: MainVideoControls | null = requestId
    ? {
        checklist: renderChecklist,
        productionStarted,
        starting: sendingProduction,
        onStart: startMainRender,
        video: mainVideoOutput
          ? {
              url: mainVideoOutput.url,
              ratio: mainVideoOutput.ratio,
              madeOn: mainVideoOutput.madeOn,
              assetId: mainVideoOutput.assetId,
            }
          : null,
        requestId,
        channel: channelShapes(orderedPlatforms).find((shape) => shape.ratio === primaryRatio)
          ?.channels.join(", "),
        resume: resumeControls,
        atReview: atVideoGate,
        approved: mainApproved,
        regenerating: regenerating || sendingProduction,
        onRegenerate: () => void regenerateVideo(),
        regenerateBlocker: regenerateBlocker,
        onChannels: () => setStep("channels"),
        error: videoError,
        timeline,
        elapsed,
        phoneError: mainFailure?.summary ?? null,
        phoneErrorLog: mainFailure?.log ?? [],
      }
    : null;

  // Render and Channels show their own Resume, next to the progress it resumes.
  const showActions =
    busy || (canResume && step !== "render" && step !== "channels");

  return (
    <main className="studio" lang={locale}>
      <header className="studio-header">
        <ServerBadge />
        <h1 className="studio-title">{requestLabel ?? t("studio.editor.title")}</h1>
        <p className="studio-subtitle">
          {requestId ? t("studio.editor.subtitleRequest") : t("studio.editor.subtitleDraft")}
        </p>
      </header>

      <nav className="studio-steps" aria-label={t("studio.editor.stepsLabel")}>
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
            {stepLabel(t, entry.id)}
          </button>
        ))}
      </nav>

      <div className="studio-body">
        <CapabilityNotice capability={capability} />
        {step === "brief" && !submitted && quota && !quota.canSubmit && (
          <QuotaStatus quota={quota} />
        )}

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
                  quota={submitted ? null : quota}
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
                ? t("studio.msg.planError")
                : null
            }
            lockedNote={
              editLocked
                ? t("studio.msg.lockedStoryboard")
                : null
            }
            disabled={busy || editLocked || sendingProduction}
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
              setMessage(t("studio.msg.soundConfirmed"));
            }}
            confirmBlocker={
              productionStarted || voiceStatus === "approved"
                ? null
                : scriptStatus === "review"
                  ? t("studio.blocker.approveScript")
                  : voiceStatus === "review"
                    ? t("studio.blocker.listenVoice")
                    : t("studio.blocker.voiceNeeded")
            }
            locked={editLocked}
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
              setMessage(
                mainVideoOutput
                  ? t("studio.msg.lookConfirmedRegenerate")
                  : t("studio.msg.lookConfirmed")
              );
            }}
            locked={editLocked}
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
            pipelineStatus={pipelineStepText(t, step_)}
            main={mainControls}
          />
        )}

        {step === "channels" && (
          <ChannelsPanel
            requestId={requestId}
            resume={resumeControls}
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
            failure={shapeFailure}
          />
        )}

        <div role="status" aria-live="polite" style={{ display: "grid", gap: 8 }}>
          {message && <p className="studio-note">{message}</p>}
          {error && <p className="studio-note studio-note-danger">{error}</p>}
        </div>
      </div>

      <QuotaDialog
        open={quotaDialog}
        renewsAt={quota?.renewsAt ?? null}
        onClose={() => setQuotaDialog(false)}
      />

      {showActions && (
        <div className="studio-actions">
          {busy ? (
            <button
              type="button"
              className="studio-button studio-button-ghost"
              onClick={() => void cancel()}
            >
              {t("studio.editor.stop")}
            </button>
          ) : (
            <button
              type="button"
              className="studio-button studio-button-primary"
              disabled={!nativeReady}
              onClick={() => {
                void resumeRender();
              }}
            >
              {t("studio.editor.resume")}
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

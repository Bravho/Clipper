/**
 * Production binding of LabIo to the REAL studio functions. Each method names
 * the existing function it calls. The editor's own defaults are used wherever
 * the editor would choose a value (platform, voice, template, text style,
 * music, subtitle languages, transitions). Nothing here is a new product choice.
 *
 * ENDPOINTS REACHED (normal routes, with the caller's own session; none of them
 * checks the lab flag or the provider switch itself):
 *  - fetchTestMedia        GET  /api/lab/test-media/{name}        (lab-only route)
 *  - createDraft           POST /api/lab/autorun/draft            (lab-only route; provider switch checked)
 *  - submit                POST /api/requests/{id}/submit         (normal studio route; quota slot)
 *  - content               GET  /api/device-render/content        (normal, read-only)
 *  - approveContent        POST /api/requests/{id}/start-production
 *  - approveVoice          POST /api/requests/{id}/approve-voice  (voice generation)
 *  - approveProduction     POST /api/requests/{id}/scene-design/approve
 *  - approveVideo          POST /api/requests/{id}/approve-overlay
 *  - render                POST /api/device-render/claim, /progress, /{attempt}/upload, /{attempt}/complete, /{attempt}/release
 * The live guard is read before each call above. Server-side disabling of the
 * lab path is enforced ONLY on the lab-only routes; the normal routes above are
 * not gated by it. Making them refuse for the lab account needs a shared-path
 * change (see the proposal in the checklist) and is not applied.
 *
 * Browser-only (phone WebView). Not run in unit tests except through mocked
 * modules. Every external call goes through the live guard first, and the
 * render goes through the bounded driver. Device deletion is NOT wired here:
 * the lab client refuses cleanup unless a reviewed deleter is supplied.
 */

import {
  approveStudioContent,
  approveStudioProduction,
  approveStudioVideo,
  approveStudioVoice,
  fetchStudioContent,
  submitStudioRequest,
  type StudioContent,
} from "@/features/device-render/studioPipeline";
import type { StudioScenePlan, StoryboardPlanScene } from "@/features/device-render/editorState";
import { loadLocalMediaIndex } from "@/features/requests/localMediaStore";
import { runDeviceRender } from "@/lib/mobile/deviceRenderClient";
import { Platform } from "@/domain/enums/Platform";
import { DEFAULT_ELEVENLABS_VOICE_ID } from "@/config/elevenLabsVoices";
import { DEFAULT_MONTAGE_TRANSITION, type MontageTransition } from "@/config/montage";
import { DEFAULT_TEXT_GRAPHIC_CHOICE } from "@/config/textGraphicStyles";
import { NO_MUSIC_TRACK_ID } from "@/config/backgroundMusic";
import { DEFAULT_TEMPLATE_ID } from "@/config/motionTemplates";
import { LAB_FIXED_DURATION_SECONDS } from "@/lib/lab/labCostBasis";
import type { LabIo, LabContentView, LabScriptView } from "@/lib/lab/labClient";
import type { LabStoryboardScene } from "@/features/requests/labAutoRun";
import type { LabLiveGuard } from "@/lib/lab/labGuards";
import { createRenderAdapter, type RunArtifactRegistry } from "@/lib/lab/labRuntime";
import type { RenderOutcomeLike } from "@/lib/lab/labRenderDriver";
import type { LabSpendLedger } from "@/lib/lab/labSpendLedger";
import { LabStopped } from "@/features/requests/labAutoRun";
import type { PreparedLabSource } from "@/lib/lab/labMediaPrep";
import type { DeviceRenderPost } from "@/lib/mobile/deviceRenderClient";
import { labActionForDeviceCall } from "@/lib/lab/labRouteTable";

/** The platform and captions the editor starts with. */
export const LAB_EDITOR_DEFAULTS = {
  platforms: [Platform.TikTok],
  voiceId: DEFAULT_ELEVENLABS_VOICE_ID,
  templateId: DEFAULT_TEMPLATE_ID,
  textStyle: DEFAULT_TEXT_GRAPHIC_CHOICE,
  musicTrackId: null as string | null,
  subtitleLanguages: ["en", "zh"],
} as const;

/** Storyboard scene (lab shape) -> the editor's storyboard shape. Same zero-based asset indexes. */
export function toStoryboardPlan(scenes: LabStoryboardScene[]): StoryboardPlanScene[] {
  return scenes.map((scene, i) => ({
    sceneNumber: i + 1,
    summary: scene.summary,
    assetIndexes: [...scene.sourceIndexes],
  }));
}

/**
 * The lab's scene plan -> the editor's scene plan. Transitions follow the
 * editor: the first scene is a cut, the rest use the default transition.
 */
export function toStudioScenePlan(
  plan: { sceneNumber: number; durationSeconds: number; visualDescriptionThai: string; imageIndexes: number[]; assets: { assetIndex: number; kind: "image" | "clip"; motion: "static"; durationSeconds: number; focusX: number; focusY: number; frameZoom: number }[] }[]
): StudioScenePlan[] {
  return plan.map((scene, i) => ({
    sceneNumber: scene.sceneNumber,
    durationSeconds: scene.durationSeconds,
    visualDescriptionThai: scene.visualDescriptionThai,
    imageIndexes: scene.imageIndexes,
    transitionIn: (i === 0 ? "cut" : DEFAULT_MONTAGE_TRANSITION) as MontageTransition,
    assets: scene.assets.map((a) => ({
      assetIndex: a.assetIndex,
      kind: a.kind,
      motion: a.motion,
      durationSeconds: a.durationSeconds,
      focusX: a.focusX,
      focusY: a.focusY,
      frameZoom: a.frameZoom,
    })),
  }));
}

/** Storyboard scenes from the server's storyboard: the fixed lab length split evenly. */
export function labScenesFromStoryboard(storyboard: StoryboardPlanScene[]): LabStoryboardScene[] {
  const each = storyboard.length > 0 ? LAB_FIXED_DURATION_SECONDS / storyboard.length : 0;
  return storyboard.map((scene) => ({
    summary: scene.summary,
    sourceIndexes: [...scene.assetIndexes],
    durationSeconds: Math.round(each * 100) / 100,
  }));
}

/** Request bodies, the same fields the studio's own approval calls send. */
export function contentStepBody(input: { script: LabScriptView; storyboard: LabStoryboardScene[]; voiceId: string }) {
  return {
    scriptThai: input.script.text,
    scriptEnglish: input.script.english,
    hookEnglish: null,
    captionThai: input.script.caption,
    captionEnglish: input.script.captionEnglish,
    captionChinese: input.script.captionChinese,
    storyboard: toStoryboardPlan(input.storyboard),
    voiceId: input.voiceId,
  };
}

export function voiceStepBody(jobId: string, platforms: string[]) {
  return { jobId, targetPlatforms: platforms, musicSelected: LAB_EDITOR_DEFAULTS.musicTrackId !== NO_MUSIC_TRACK_ID };
}

export function productionStepBody(input: { jobId: string; scenePlan: StudioScenePlan[]; durationSeconds: number }) {
  return {
    jobId: input.jobId,
    scenePlan: input.scenePlan,
    durationSeconds: input.durationSeconds,
    selectedMusicTrack: LAB_EDITOR_DEFAULTS.musicTrackId ?? NO_MUSIC_TRACK_ID,
    subtitleLanguages: [...LAB_EDITOR_DEFAULTS.subtitleLanguages].slice(0, 2),
    selectedMotionTemplate: LAB_EDITOR_DEFAULTS.templateId,
    selectedTextStyle: LAB_EDITOR_DEFAULTS.textStyle,
    autoApproveRemaining: true,
  };
}

export function videoStepBody(jobId: string) {
  return { jobId };
}

export interface StudioBindingDeps {
  ledger: Pick<LabSpendLedger, "usedToday">;
  guard: LabLiveGuard;
  registry: RunArtifactRegistry;
  runId: string;
  /** Video helpers that need the browser (poster frame, duration). Injected so tests can stub them. */
  /** Prepares one clip for the studio (see labMediaPrep.ts). The caller releases the preview URL. */
  prepareSource(file: File): Promise<PreparedLabSource>;
  /** The test place is read here, and validated by the entry before any call. */
  testPlace: { placeName: string; latitude: number; longitude: number };
  fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  fetchBlob(url: string): Promise<Blob>;
  /** The runner's render step: production uses the real runDeviceRender. */
  runDeviceRender?: typeof runDeviceRender;
  maxRenderSteps: number;
}

export function createLabStudioIo(deps: StudioBindingDeps): LabIo & { adapter: ReturnType<typeof createRenderAdapter> } {
  const materialsByRequest = new Map<string, string[]>();
  const renderOnce = deps.runDeviceRender ?? runDeviceRender;

  const adapter = createRenderAdapter({
    runId: deps.runId,
    registry: deps.registry,
    flagOn: () => !deps.guard.isStopped(),
    cancelled: () => deps.guard.isStopped(),
    maxSteps: deps.maxRenderSteps,
    materialsForRequest: async (requestId) => materialsByRequest.get(requestId) ?? [],
    runOnce: async ({ requestId, shouldCancel }): Promise<RenderOutcomeLike> => {
      const outcome = await renderOnce({
        requestId,
        localMedia: await loadLocalMediaIndex(),
        shouldCancel,
        // Every lifecycle call goes through the server step route, mapped by the allow-list.
        post: labDevicePost(requestId),
      });
      return {
        status: outcome.status,
        reason: outcome.reason,
        assetId: outcome.assetId ?? null,
        attemptId: outcome.attemptId ?? null,
      };
    },
  });

  /** Checked before every direct call to a normal studio route, and before each step. */
  const live = (at: string) => {
    if (deps.guard.isStopped()) throw new LabStopped(at);
  };

  /** One call to the server-guarded step route for this run. */
  const stepCall = (action: string, requestId: string, payload: unknown, attemptId?: string) =>
    deps.fetchJson("/api/lab/autorun/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action, runId: deps.runId, attemptId, payload }),
    });

  /** Every chargeable approval goes through the server-guarded step route, with the run id. */
  const postLabStep = async (action: string, requestId: string, payload: unknown): Promise<void> => {
    const res = await stepCall(action, requestId, payload);
    if (!res.ok) throw new Error(`lab step ${action} refused (${res.status})`);
  };

  /** The device-render lifecycle for one request, routed through the step route. Unmapped calls are refused. */
  const labDevicePost =
    (requestId: string): DeviceRenderPost =>
    async <T,>(url: string, body: unknown): Promise<T> => {
      const mapped = labActionForDeviceCall(url, body);
      if (!mapped) throw new Error("lab device call is not on the allow-list");
      const res = await stepCall(mapped.action, requestId, body, mapped.attemptId);
      if (!res.ok) throw new Error(`lab device call refused (${res.status})`);
      return (await res.json()) as T;
    };

  const io = {
    adapter,

    async fetchTestMedia(name: string): Promise<File> {
      live("fetch");
      const blob = await deps.fetchBlob(`/api/lab/test-media/${encodeURIComponent(name)}`);
      return new File([blob], name, { type: "video/mp4" });
    },

    async spentTodayCredits(): Promise<number> {
      const used = await deps.ledger.usedToday();
      if (used === null) throw new Error("lab ledger unreadable; no run");
      return used;
    },

    async createDraft(form: { title: string; placeName: string; latitude: number; longitude: number; description: string }): Promise<string> {
      live("create_draft");
      const res = await deps.fetchJson("/api/lab/autorun/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...labDraftForm(form), runId: deps.runId }),
      });
      if (!res.ok) throw new Error(`lab draft refused (${res.status})`);
      const body = (await res.json()) as { requestId?: unknown };
      if (typeof body.requestId !== "string" || body.requestId.length === 0) throw new Error("lab draft: no request id");
      return body.requestId;
    },

    async submit(requestId: string, files: File[]): Promise<void> {
      live("submit");
      const before = new Set((await loadLocalMediaIndex()).keys());
      const prepared: PreparedLabSource[] = [];
      try {
        const sources = [];
        for (const [i, file] of files.entries()) {
          live("submit");
          const p = await deps.prepareSource(file);
          prepared.push(p);
          sources.push({
            id: `lab-${i}`,
            kind: "clip" as const,
            file,
            previewUrl: p.previewUrl,
            posterUrl: p.posterUrl,
            durationSeconds: p.durationSeconds,
            fileName: file.name,
          });
        }
        live("submit");
        // POST /api/requests/{id}/submit (normal studio route, the caller's own session)
        // The submit goes through the step route. The studio's own body is the payload.
        const transport = async (_url: string, body: unknown): Promise<Response> => {
          const res = await stepCall("submit", requestId, body);
          return new Response(JSON.stringify(await res.json().catch(() => null)), { status: res.status });
        };
        await submitStudioRequest({ requestId, sources, transport });
        // The materials this run stored are the ones that were not there before.
        const added = [...(await loadLocalMediaIndex()).keys()].filter((id) => !before.has(id));
        materialsByRequest.set(requestId, added);
      } finally {
        // Only the temporary preview URLs are released. The files are never touched.
        for (const p of prepared) p.release();
      }
    },

    async content(requestId: string): Promise<LabContentView | null> {
      live("content");
      const c: StudioContent = await fetchStudioContent(requestId);
      if (!c.submitted || !c.jobId) return null;
      const storyboard = c.storyboard ?? null;
      return {
        jobId: c.jobId,
        scenes: storyboard ? labScenesFromStoryboard(storyboard) : null,
        script: c.script ? (c.script as LabScriptView) : null,
        voiceId: LAB_EDITOR_DEFAULTS.voiceId,
        voiceReady: c.voice !== null,
        platforms: [...LAB_EDITOR_DEFAULTS.platforms],
        sourceKinds: c.localMedia.map((m) => (m.mimeType.startsWith("video/") ? "clip" : "image")),
      };
    },

    async approveContent(requestId: string, input: { script: LabScriptView; storyboard: LabStoryboardScene[]; voiceId: string }): Promise<void> {
      live("approve_content");
      await postLabStep("start-production", requestId, contentStepBody(input));
    },

    async approveVoice(requestId: string, jobId: string, platforms: string[]): Promise<void> {
      live("voice");
      await postLabStep("approve-voice", requestId, voiceStepBody(jobId, platforms));
    },

    async approveProduction(requestId: string, jobId: string, plan: unknown[]): Promise<void> {
      live("scene_design");
      const scenes = plan as Parameters<typeof toStudioScenePlan>[0];
      const durationSeconds = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
      await postLabStep("scene-design-approve", requestId, productionStepBody({
        jobId,
        scenePlan: toStudioScenePlan(scenes),
        durationSeconds: Math.round(durationSeconds * 100) / 100,
      }));
    },

    async approveVideo(requestId: string, jobId: string): Promise<void> {
      live("approve_video");
      await postLabStep("approve-overlay", requestId, videoStepBody(jobId));
    },

    waitForRender: (requestId: string, jobId: string) => adapter.waitForRender(requestId, jobId),
    uploadAndConfirm: (requestId: string, outputId: string) => adapter.uploadAndConfirm(requestId, outputId),
  };

  return io as LabIo & { adapter: typeof adapter };
}

/**
 * The draft form the studio's own validation accepts: the editor's default platform,
 * and the fixed lab length. The studio schema requires targetPlatforms (at least one)
 * and a duration; without them every lab draft is refused.
 */
export function labDraftForm(form: { title: string; placeName: string; latitude: number; longitude: number; description: string }) {
  return {
    ...form,
    targetPlatforms: [...LAB_EDITOR_DEFAULTS.platforms],
    durationSeconds: LAB_FIXED_DURATION_SECONDS,
  };
}

/** Test place from configuration. Validation happens in the entry, before any reservation. */
export function labTestPlaceFromEnv(env: Record<string, string | undefined>): { placeName: string; latitude: number; longitude: number } | null {
  const placeName = env.LAB_TEST_PLACE_NAME;
  const latitude = Number(env.LAB_TEST_PLACE_LAT);
  const longitude = Number(env.LAB_TEST_PLACE_LNG);
  if (!placeName || env.LAB_TEST_PLACE_LAT === undefined || env.LAB_TEST_PLACE_LNG === undefined) return null;
  return { placeName, latitude, longitude };
}

/**
 * Production binding of LabIo to the REAL studio functions. Each method names
 * the existing function it calls. The editor's own defaults are used wherever
 * the editor would choose a value (platform, voice, template, text style,
 * music, subtitle languages, transitions). Nothing here is a new product choice.
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

export interface StudioBindingDeps {
  ledger: Pick<LabSpendLedger, "usedToday">;
  guard: LabLiveGuard;
  registry: RunArtifactRegistry;
  runId: string;
  /** Video helpers that need the browser (poster frame, duration). Injected so tests can stub them. */
  prepareSource(file: File): Promise<{ posterUrl: string | null; durationSeconds: number | null; previewUrl: string }>;
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
      });
      return { status: outcome.status, reason: outcome.reason, assetId: outcome.assetId ?? null };
    },
  });

  const io = {
    adapter,

    async fetchTestMedia(name: string): Promise<File> {
      const blob = await deps.fetchBlob(`/api/lab/test-media/${encodeURIComponent(name)}`);
      return new File([blob], name, { type: "video/mp4" });
    },

    async spentTodayCredits(): Promise<number> {
      const used = await deps.ledger.usedToday();
      if (used === null) throw new Error("lab ledger unreadable; no run");
      return used;
    },

    async createDraft(form: { title: string; placeName: string; latitude: number; longitude: number; description: string }): Promise<string> {
      const res = await deps.fetchJson("/api/lab/autorun/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`lab draft refused (${res.status})`);
      const body = (await res.json()) as { requestId?: unknown };
      if (typeof body.requestId !== "string" || body.requestId.length === 0) throw new Error("lab draft: no request id");
      return body.requestId;
    },

    async submit(requestId: string, files: File[]): Promise<void> {
      const before = new Set((await loadLocalMediaIndex()).keys());
      const sources = [];
      for (const [i, file] of files.entries()) {
        const prepared = await deps.prepareSource(file);
        sources.push({
          id: `lab-${i}`,
          kind: "clip" as const,
          file,
          previewUrl: prepared.previewUrl,
          posterUrl: prepared.posterUrl,
          durationSeconds: prepared.durationSeconds,
          fileName: file.name,
        });
      }
      await submitStudioRequest({ requestId, sources });
      // The materials this run stored are the ones that were not there before.
      const added = [...(await loadLocalMediaIndex()).keys()].filter((id) => !before.has(id));
      materialsByRequest.set(requestId, added);
    },

    async content(requestId: string): Promise<LabContentView | null> {
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
      await approveStudioContent({
        requestId,
        script: input.script,
        storyboard: toStoryboardPlan(input.storyboard),
        voiceId: input.voiceId as typeof DEFAULT_ELEVENLABS_VOICE_ID,
      });
    },

    async approveVoice(requestId: string, jobId: string, platforms: string[]): Promise<void> {
      await approveStudioVoice({
        requestId,
        jobId,
        platforms: platforms as Platform[],
        musicSelected: LAB_EDITOR_DEFAULTS.musicTrackId !== NO_MUSIC_TRACK_ID,
      });
    },

    async approveProduction(requestId: string, jobId: string, plan: unknown[]): Promise<void> {
      const scenes = plan as Parameters<typeof toStudioScenePlan>[0];
      const durationSeconds = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
      await approveStudioProduction({
        requestId,
        jobId,
        scenePlan: toStudioScenePlan(scenes),
        durationSeconds: Math.round(durationSeconds * 100) / 100,
        musicTrackId: LAB_EDITOR_DEFAULTS.musicTrackId,
        subtitleLanguages: [...LAB_EDITOR_DEFAULTS.subtitleLanguages],
        templateId: LAB_EDITOR_DEFAULTS.templateId,
        textStyle: LAB_EDITOR_DEFAULTS.textStyle,
      });
    },

    async approveVideo(requestId: string, jobId: string): Promise<void> {
      await approveStudioVideo({ requestId, jobId });
    },

    waitForRender: (requestId: string, jobId: string) => adapter.waitForRender(requestId, jobId),
    uploadAndConfirm: (requestId: string, outputId: string) => adapter.uploadAndConfirm(requestId, outputId),
  };

  return io as LabIo & { adapter: typeof adapter };
}

/** Test place from configuration. Validation happens in the entry, before any reservation. */
export function labTestPlaceFromEnv(env: Record<string, string | undefined>): { placeName: string; latitude: number; longitude: number } | null {
  const placeName = env.LAB_TEST_PLACE_NAME;
  const latitude = Number(env.LAB_TEST_PLACE_LAT);
  const longitude = Number(env.LAB_TEST_PLACE_LNG);
  if (!placeName || env.LAB_TEST_PLACE_LAT === undefined || env.LAB_TEST_PLACE_LNG === undefined) return null;
  return { placeName, latitude, longitude };
}

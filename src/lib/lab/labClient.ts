/**
 * Lab client: maps the orchestrator's steps onto an injected LabIo. The real
 * LabIo (studio functions, lab HTTP routes, the phone's file store) is supplied
 * later by a reviewed production binding. Tests inject mocks.
 *
 * Safety defaults:
 *  - Device deletion is refused unless a DeviceFileOps is injected. Without one,
 *    the cleanup steps throw, and the files stay.
 *  - A draft needs an explicit test place. Without one, no draft is created.
 *  - Waits are bounded.
 */

import { waitBounded } from "@/lib/lab/labSteps";
import { labMaxRunCredits, LAB_FIXED_CHANNELS, LAB_FIXED_DURATION_SECONDS } from "@/lib/lab/labCostBasis";
import type { LabRunDepsWithoutHook } from "@/lib/lab/labRuntime";
import type { DeviceFileOps } from "@/lib/lab/labRuntime";
import type { LabStoryboardScene } from "@/features/requests/labAutoRun";

/** What the lab needs from the outside world. Every method is one existing capability. */
export interface LabIo {
  fetchTestMedia(name: string): Promise<File>;
  spentTodayCredits(): Promise<number>;
  createDraft(form: { title: string; placeName: string; latitude: number; longitude: number; description: string }): Promise<string>;
  submit(requestId: string, files: File[]): Promise<void>;
  /** Null until the server has something to show; otherwise the current content. */
  content(requestId: string): Promise<LabContentView | null>;
  approveContent(requestId: string, input: { script: LabScriptView; storyboard: LabStoryboardScene[]; voiceId: string }): Promise<void>;
  approveVoice(requestId: string, jobId: string, platforms: string[]): Promise<void>;
  approveProduction(requestId: string, jobId: string, plan: unknown[]): Promise<void>;
  approveVideo(requestId: string, jobId: string): Promise<void>;
  /** Waits for the render steps; resolves to the run's durable outputs and materials. */
  waitForRender(requestId: string, jobId: string): Promise<{ outputIds: string[]; materialIds: string[] }>;
  uploadAndConfirm(requestId: string, outputId: string): Promise<boolean>;
}

export interface LabScriptView {
  text: string;
  english: string;
  caption: string;
  captionEnglish: string;
  captionChinese: string;
}

export interface LabContentView {
  jobId: string | null;
  scenes: LabStoryboardScene[] | null;
  script: LabScriptView | null;
  voiceId: string | null;
  voiceReady: boolean;
  platforms: string[];
  sourceKinds: ("image" | "clip")[];
}

export interface LabClientOptions {
  /** A test place. Required: no draft is created without it. */
  testPlace: { placeName: string; latitude: number; longitude: number } | null;
  waitMaxAttempts: number;
  waitIntervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  /** Injected only in tests. Production passes nothing, so no device file is deleted. */
  deviceFiles?: DeviceFileOps;
}

export function createLabClient(io: LabIo, options: LabClientOptions): LabRunDepsWithoutHook {
  const waitOpts = {
    maxAttempts: options.waitMaxAttempts,
    intervalMs: options.waitIntervalMs,
    sleep: options.sleep,
  };

  return {
    fetchTestMedia: (name) => io.fetchTestMedia(name),

    async quoteCapState() {
      const quote = labMaxRunCredits(LAB_FIXED_DURATION_SECONDS, LAB_FIXED_CHANNELS);
      if (!quote.ok) throw new Error(`lab run quote refused: ${quote.reason}`);
      return { spentTodayCredits: await io.spentTodayCredits(), quotedRunCredits: quote.maxCredits };
    },

    async createDraft() {
      if (!options.testPlace) throw new Error("lab draft refused: no test place is configured");
      const { placeName, latitude, longitude } = options.testPlace;
      return io.createDraft({ title: "Lab test clip", placeName, latitude, longitude, description: "" });
    },

    submit: (requestId, files) => io.submit(requestId, files),

    async waitForContent(requestId) {
      const ready = await waitBounded(async () => {
        const c = await io.content(requestId);
        return c && c.jobId && c.script && c.scenes ? c : null;
      }, waitOpts);
      if (ready.status !== "ready") throw new Error(`lab content not ready (${ready.status})`);
      const c = ready.value;
      return {
        jobId: c.jobId as string,
        scenes: c.scenes as LabStoryboardScene[],
        sourceKinds: c.sourceKinds,
        platforms: c.platforms,
        voiceId: c.voiceId ?? "",
        script: c.script as LabScriptView,
      };
    },

    async approveContent(requestId, content) {
      await io.approveContent(requestId, {
        script: content.script,
        storyboard: content.scenes,
        voiceId: content.voiceId,
      });
    },

    async waitForVoice(requestId) {
      const ready = await waitBounded(async () => {
        const c = await io.content(requestId);
        return c && c.voiceReady ? true : null;
      }, waitOpts);
      if (ready.status !== "ready") throw new Error(`lab voice not ready (${ready.status})`);
    },

    approveVoice: (requestId, jobId, platforms) => io.approveVoice(requestId, jobId, platforms),

    approveProduction: (requestId, jobId, plan) => io.approveProduction(requestId, jobId, plan),

    waitForRender: (requestId, jobId) => io.waitForRender(requestId, jobId),

    uploadAndConfirm: (requestId, outputId) => io.uploadAndConfirm(requestId, outputId),

    approveVideo: (requestId, jobId) => io.approveVideo(requestId, jobId),

    async deleteLabMaterials(ids) {
      if (!options.deviceFiles) throw new Error("device deletion is not enabled; files are kept");
      for (const id of ids) await options.deviceFiles.deleteMaterial(id);
    },

    async deleteLabOutputs(ids) {
      if (!options.deviceFiles) throw new Error("device deletion is not enabled; files are kept");
      for (const id of ids) await options.deviceFiles.deleteOutput(id);
    },
  };
}

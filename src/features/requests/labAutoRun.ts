/**
 * Lab-only auto-run for the phone studio. Pure orchestration: every step that
 * touches the server, the phone storage or a file is injected, so the order,
 * the credit caps and the deletion rules can be unit-tested with no phone and
 * no live run.
 *
 * Off unless NEXT_PUBLIC_LAB_AUTORUN is exactly "true" at build time, and the
 * caller must also pass the lab account check. Nothing here is wired to real
 * screens yet.
 *
 * Deletion rules (see plan-server-side-device-render.md):
 *  - Source files are deleted only after the phone render has finished, and only
 *    the ones this run itself stored.
 *  - Generated videos are deleted only after the upload is confirmed, and only
 *    the ones this run itself produced. Until then they are kept.
 */

export const LAB_PER_RUN_CREDIT_CAP = 350;
export const LAB_PER_DAY_CREDIT_CAP = 1000;

export function labAutoRunEnabled(flag: string | undefined): boolean {
  return flag === "true";
}

/** Minimal storyboard scene the default plan needs. */
export interface LabStoryboardScene {
  summary: string;
  /** Indexes into the ordered source list, one per shot, in render order. */
  sourceIndexes: number[];
  durationSeconds: number;
}

/** Minimal shape of one scene in the scene-design approval. */
export interface LabScenePlan {
  sceneNumber: number;
  durationSeconds: number;
  visualDescriptionThai: string;
  imageIndexes: number[];
  assets: {
    assetIndex: number;
    kind: "image" | "clip";
    motion: "static";
    durationSeconds: number;
    focusX: number;
    focusY: number;
    frameZoom: number;
  }[];
}

/**
 * A plain, deterministic scene plan: one scene per storyboard scene, one shot
 * per listed source, centred focus, no camera move, no trims. Plainer than a
 * hand-edited plan, by design for the first lab runs.
 */
export function defaultLabScenePlan(
  scenes: LabStoryboardScene[],
  sourceKinds: ("image" | "clip")[]
): LabScenePlan[] {
  const plan: LabScenePlan[] = [];
  for (const scene of scenes) {
    const assets: LabScenePlan["assets"] = [];
    for (const index of scene.sourceIndexes) {
      const kind = sourceKinds[index];
      if (kind === undefined) continue;
      assets.push({
        assetIndex: index,
        kind,
        motion: "static",
        durationSeconds: Math.max(1, Math.round((scene.durationSeconds / scene.sourceIndexes.length) * 100) / 100),
        focusX: 0.5,
        focusY: 0.5,
        frameZoom: 1,
      });
    }
    if (assets.length === 0) continue;
    const imageIndexes = [...new Set(assets.map((asset) => asset.assetIndex))];
    plan.push({
      sceneNumber: plan.length + 1,
      durationSeconds: Math.round(scene.durationSeconds * 100) / 100,
      visualDescriptionThai: scene.summary,
      imageIndexes,
      assets,
    });
  }
  return plan;
}

export interface LabCapState {
  /** Credits this lab account has already spent today (from the server ledger). */
  spentTodayCredits: number;
  /** Quoted cost of the next run, from the server before any spend. */
  quotedRunCredits: number;
}

/** Null when the run may start, otherwise the reason it must not. */
export function labCapRefusal(state: LabCapState): string | null {
  if (state.quotedRunCredits > LAB_PER_RUN_CREDIT_CAP) {
    return `run_over_cap:${state.quotedRunCredits}>${LAB_PER_RUN_CREDIT_CAP}`;
  }
  if (state.spentTodayCredits + state.quotedRunCredits > LAB_PER_DAY_CREDIT_CAP) {
    return `day_over_cap:${state.spentTodayCredits}+${state.quotedRunCredits}>${LAB_PER_DAY_CREDIT_CAP}`;
  }
  return null;
}

export interface LabRunDeps {
  /** The test clips' names in the order to use them. */
  fetchTestMedia(name: string): Promise<File>;
  quoteCapState(): Promise<LabCapState>;
  createDraft(): Promise<string>;
  /** Persists the spend-attempt marker. Must resolve only after it is durable. */
  beforeSpend(requestId: string): Promise<void>;
  submit(requestId: string, files: File[]): Promise<void>;
  /** Waits until the script and storyboard are ready. Returns the job id and scenes. */
  waitForContent(requestId: string): Promise<{ jobId: string; scenes: LabStoryboardScene[]; sourceKinds: ("image" | "clip")[]; platforms: string[]; voiceId: string; script: { text: string; english: string; caption: string; captionEnglish: string; captionChinese: string } }>;
  approveContent(requestId: string, content: Awaited<ReturnType<LabRunDeps["waitForContent"]>>): Promise<void>;
  waitForVoice(requestId: string, jobId: string): Promise<void>;
  approveVoice(requestId: string, jobId: string, platforms: string[]): Promise<void>;
  approveProduction(requestId: string, jobId: string, plan: LabScenePlan[]): Promise<void>;
  /** Resolves when the phone has finished the render and the output exists. */
  waitForRender(requestId: string, jobId: string): Promise<{ outputIds: string[]; materialIds: string[] }>;
  /** Uploads the output to Mar-PC or cloud temporary storage, returns true only when confirmed. */
  uploadAndConfirm(requestId: string, outputId: string): Promise<boolean>;
  approveVideo(requestId: string, jobId: string): Promise<void>;
  /** Deletes only files this run stored on the phone. */
  deleteLabMaterials(materialIds: string[]): Promise<void>;
  /** Deletes only outputs this run produced on the phone, after confirmation. */
  deleteLabOutputs(outputIds: string[]): Promise<void>;
}

export type LabRunResult =
  | { status: "disabled" }
  | { status: "refused"; reason: string }
  | { status: "failed"; step: string; error: string; requestId: string | null }
  | { status: "done"; requestId: string; outputIds: string[]; keptOutputIds: string[] };

export interface LabRunOptions {
  flag: string | undefined;
  /** Test file names, in order. */
  fileNames: string[];
}

export async function runLabAutoRun(deps: LabRunDeps, options: LabRunOptions): Promise<LabRunResult> {
  if (!labAutoRunEnabled(options.flag)) return { status: "disabled" };
  if (options.fileNames.length === 0) return { status: "refused", reason: "no_files" };

  const cap = labCapRefusal(await deps.quoteCapState());
  if (cap) return { status: "refused", reason: cap };

  let requestId: string | null = null;
  let step = "fetch";
  try {
    const files: File[] = [];
    for (const name of options.fileNames) files.push(await deps.fetchTestMedia(name));

    step = "create_draft";
    requestId = await deps.createDraft();

    // Persist the spend-attempt marker BEFORE the first chargeable request.
    // If it cannot be persisted, nothing is dispatched.
    step = "before_spend";
    await deps.beforeSpend(requestId);

    step = "submit";
    await deps.submit(requestId, files);

    step = "content";
    const content = await deps.waitForContent(requestId);

    step = "approve_content";
    await deps.approveContent(requestId, content);

    step = "voice";
    await deps.waitForVoice(requestId, content.jobId);
    await deps.approveVoice(requestId, content.jobId, content.platforms);

    step = "scene_design";
    const plan = defaultLabScenePlan(content.scenes, content.sourceKinds);
    await deps.approveProduction(requestId, content.jobId, plan);

    step = "render";
    const rendered = await deps.waitForRender(requestId, content.jobId);

    // Source files go as soon as the phone render is finished. Nothing else
    // needs them after that.
    step = "delete_sources";
    await deps.deleteLabMaterials(rendered.materialIds);

    step = "upload";
    const confirmed: string[] = [];
    const kept: string[] = [];
    for (const outputId of rendered.outputIds) {
      if (await deps.uploadAndConfirm(requestId, outputId)) confirmed.push(outputId);
      else kept.push(outputId);
    }

    step = "approve_video";
    await deps.approveVideo(requestId, content.jobId);

    // Generated videos go only once the server has them. Unconfirmed ones stay.
    step = "delete_outputs";
    await deps.deleteLabOutputs(confirmed);

    return { status: "done", requestId, outputIds: confirmed, keptOutputIds: kept };
  } catch (error) {
    return {
      status: "failed",
      step,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    };
  }
}

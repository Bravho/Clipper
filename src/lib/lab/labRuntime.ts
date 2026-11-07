/**
 * Lifecycle binding for one lab run. Connects the pieces that already exist:
 *  - runLabOnce (ledger, marker, outcome rules) calls runSteps;
 *  - runSteps is createLabRunSteps: it runs the orchestrator with the marker hook;
 *  - the orchestrator's render and upload steps use the render adapter, which
 *    drives the existing runDeviceRender through driveLabRender;
 *  - cleanup is limited to artifacts registered to THIS run, and only after a
 *    durable upload.
 *
 * Nothing here calls a provider or a device directly. Every external call is
 * injected, so tests use mocks and production wires the real functions.
 */

import { runLabAutoRun, type LabRunDeps } from "@/features/requests/labAutoRun";
import type { LabRunOutcome } from "@/lib/lab/labRunner";
import { driveLabRender, type RenderOutcomeLike } from "@/lib/lab/labRenderDriver";

export class LabRenderIncomplete extends Error {
  constructor(
    readonly status: string,
    readonly step: number | null,
    readonly reason: string,
    readonly durableAssetIds: string[]
  ) {
    super(`The lab render did not finish (${status}${reason ? `: ${reason}` : ""}).`);
    this.name = "LabRenderIncomplete";
  }
}

/** Artifacts this run created on the phone, registered as they are created. */
export class RunArtifactRegistry {
  private readonly materials = new Map<string, Set<string>>();
  private readonly outputs = new Map<string, Set<string>>();

  registerMaterial(runId: string, localId: string): void {
    if (!this.materials.has(runId)) this.materials.set(runId, new Set());
    this.materials.get(runId)!.add(localId);
  }

  registerOutput(runId: string, assetId: string): void {
    if (!this.outputs.has(runId)) this.outputs.set(runId, new Set());
    this.outputs.get(runId)!.add(assetId);
  }

  materialsOf(runId: string): string[] {
    return [...(this.materials.get(runId) ?? [])];
  }

  outputsOf(runId: string): string[] {
    return [...(this.outputs.get(runId) ?? [])];
  }
}

export interface RenderAdapterDeps {
  runId: string;
  registry: RunArtifactRegistry;
  flagOn(): boolean;
  /** One existing device-render step (runDeviceRender in production). */
  runOnce(input: { requestId: string; shouldCancel: () => boolean }): Promise<RenderOutcomeLike>;
  maxSteps: number;
  cancelled(): boolean;
  /** The sources this run stored on the phone for this request. */
  materialsForRequest(requestId: string): Promise<string[]>;
}

/**
 * The render and upload steps for the orchestrator. waitForRender runs the
 * bounded driver; uploadAndConfirm answers only for an asset the server confirmed.
 */
export function createRenderAdapter(deps: RenderAdapterDeps) {
  const confirmed = new Map<string, Set<string>>(); // requestId -> durable asset ids
  /** assetId -> attempt that produced it. An output without a matched attempt is never confirmed. */
  const attemptByAsset = new Map<string, string>();

  return {
    async waitForRender(requestId: string, _jobId: string) {
      const result = await driveLabRender(
        { requestId, maxSteps: deps.maxSteps, cancelled: deps.cancelled },
        {
          flagOn: deps.flagOn,
          runOnce: async (input) => {
            const outcome = await deps.runOnce(input);
            if (outcome.status === "completed" && typeof outcome.assetId === "string" && typeof outcome.attemptId === "string") {
              attemptByAsset.set(outcome.assetId, outcome.attemptId);
            }
            return outcome;
          },
        }
      );
      confirmed.set(requestId, new Set(result.durableAssetIds));
      // Register what this run made, so cleanup can only touch these.
      for (const id of result.durableAssetIds) deps.registry.registerOutput(deps.runId, id);
      const materialIds = await deps.materialsForRequest(requestId);
      for (const id of materialIds) deps.registry.registerMaterial(deps.runId, id);
      if (result.status !== "done") {
        const step = "step" in result ? result.step : null;
        const reason = "reason" in result ? result.reason : "";
        throw new LabRenderIncomplete(result.status, step, reason, result.durableAssetIds);
      }
      return { outputIds: result.durableAssetIds, materialIds };
    },
    async uploadAndConfirm(requestId: string, outputId: string): Promise<boolean> {
      // Confirmed for this request AND matched to an attempt. Without the attempt,
      // the output is kept (ambiguous cleanup is refused).
      return (confirmed.get(requestId)?.has(outputId) ?? false) && attemptByAsset.has(outputId);
    },
  };
}

/**
 * Device file operations. Each resolves true when it removed a file, and false
 * when the file was already absent. An absent file is NOT an error: runDeviceRender
 * already removes its own local copy of a finished render after the server
 * confirms it, so the lab cleanup must not fail on that.
 */
export interface DeviceFileOps {
  deleteMaterial(localId: string): Promise<boolean>;
  deleteOutput(assetId: string): Promise<boolean>;
}

/**
 * Cleanup that can only touch this run's own artifacts. An id that is not in the
 * run's registry is refused (not silently skipped), so a mistake shows up.
 */
export function createRunOwnedCleanup(runId: string, registry: RunArtifactRegistry, files: DeviceFileOps) {
  return {
    async deleteLabMaterials(ids: string[]): Promise<void> {
      const own = new Set(registry.materialsOf(runId));
      for (const id of ids) {
        if (!own.has(id)) throw new Error(`refused: material ${id} is not this run's`);
      }
      for (const id of ids) await files.deleteMaterial(id);
    },
    async deleteLabOutputs(ids: string[]): Promise<void> {
      const own = new Set(registry.outputsOf(runId));
      for (const id of ids) {
        if (!own.has(id)) throw new Error(`refused: output ${id} is not this run's`);
      }
      for (const id of ids) await files.deleteOutput(id);
    },
  };
}

/** The studio steps the orchestrator calls, all injected. */
export type LabRunDepsWithoutHook = Omit<LabRunDeps, "beforeSpend">;

export interface LabStepsOptions {
  flagOn(): boolean;
  fileNames: string[];
}

/**
 * The runner's `runSteps`: runs the orchestrator, passing the runner's marker
 * hook as `beforeSpend`. Returns the outcome the runner's rules need. A refusal
 * or an unexpected status is reported as failed, never as done.
 */
export function createLabRunSteps(client: LabRunDepsWithoutHook, options: LabStepsOptions) {
  return async (_runId: string, beforeSpend: () => Promise<void>): Promise<LabRunOutcome> => {
    const result = await runLabAutoRun(
      { ...client, beforeSpend },
      { flag: options.flagOn() ? "true" : undefined, fileNames: options.fileNames }
    );
    if (result.status === "done") return { status: "done" };
    if (result.status === "stopped") return { status: "cancelled", step: result.step };
    if (result.status === "failed") return { status: "failed", step: result.step };
    return { status: "failed", step: result.status };
  };
}

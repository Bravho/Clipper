/**
 * The extra channel shapes of a phone-rendered request, one link at a time.
 *
 * WHY A CHAIN. A server request composes every extra shape from masters the
 * worker already holds. A phone-rendered request has no such masters: the
 * originals are on the phone and nowhere else, so each extra shape is rebuilt
 * from them exactly as the first one was — montage, then master (voice and
 * music), then final (captions and template) — at that shape's own canvas.
 *
 * A job may hold only ONE active render task (`uq_render_tasks_active_job`),
 * so the shapes cannot be queued side by side. Instead each `AdditionalRatios`
 * task carries one link in its payload: which shape, which stage, and the
 * shapes still to do. Finishing a link enqueues the next, and finishing the
 * last one finalizes the job. Everything the chain needs travels in the task
 * payload, so no column or migration is involved.
 *
 * Pure functions only — the service and the tests share them.
 */

export type ChainRatio = "9:16" | "16:9" | "1:1" | "4:5";
export type ChainStage = "montage" | "master" | "final";

export interface DeviceRatioLink {
  /** Marks a payload written by this chain, so a legacy payload is never misread. */
  deviceChain: true;
  ratio: ChainRatio;
  stage: ChainStage;
  /** Shapes still to render after this one, in order. */
  queue: ChainRatio[];
  /** The montage this shape's master is built on (set on the master link). */
  baseAssetId?: string;
}

const RATIOS: ChainRatio[] = ["9:16", "16:9", "1:1", "4:5"];
const STAGES: ChainStage[] = ["montage", "master", "final"];

function isRatio(value: unknown): value is ChainRatio {
  return typeof value === "string" && (RATIOS as string[]).includes(value);
}

/** The first link for a list of shapes, or null when there is nothing to render. */
export function firstDeviceRatioLink(ratios: readonly string[]): DeviceRatioLink | null {
  const valid = ratios.filter(isRatio);
  if (valid.length === 0) return null;
  return { deviceChain: true, ratio: valid[0], stage: "montage", queue: valid.slice(1) };
}

/** Read a task payload as a chain link; null for anything this chain did not write. */
export function readDeviceRatioLink(payload: unknown): DeviceRatioLink | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (raw.deviceChain !== true) return null;
  if (!isRatio(raw.ratio)) return null;
  if (typeof raw.stage !== "string" || !(STAGES as string[]).includes(raw.stage)) return null;
  const queue = Array.isArray(raw.queue) ? raw.queue.filter(isRatio) : [];
  return {
    deviceChain: true,
    ratio: raw.ratio,
    stage: raw.stage as ChainStage,
    queue,
    ...(typeof raw.baseAssetId === "string" && raw.baseAssetId
      ? { baseAssetId: raw.baseAssetId }
      : {}),
  };
}

/**
 * What follows a finished link: the next stage of the same shape, the first
 * stage of the next shape, or "finalize" when every chosen shape is done.
 */
export function nextDeviceRatioLink(
  link: DeviceRatioLink,
  resultAssetId: string
): DeviceRatioLink | "finalize" {
  switch (link.stage) {
    case "montage":
      return {
        deviceChain: true,
        ratio: link.ratio,
        stage: "master",
        queue: link.queue,
        baseAssetId: resultAssetId,
      };
    case "master":
      return { deviceChain: true, ratio: link.ratio, stage: "final", queue: link.queue };
    default:
      return firstDeviceRatioLink(link.queue) ?? "finalize";
  }
}

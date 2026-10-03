import type { MessageKey } from "@/i18n/messages";
import type { DeviceRenderPhase } from "@/lib/mobile/deviceRenderClient";

/**
 * The small decisions behind "should this phone be rendering right now", kept
 * out of the component so they can be tested without a WebView.
 *
 * WHY THIS IS NOT A DETAIL. A request whose originals stayed on the phone has
 * `render_location = 'device'`, and its render tasks are `device_only` — the Mac
 * Mini worker's claim scan skips them on purpose, because it has no copy of the
 * footage. Nothing else in the system will pick that work up. So the phone
 * deciding, correctly, that it is the renderer is the difference between a
 * video that gets made and a job that sits in the queue forever.
 *
 * The three gates below are the only reasons a phone standing in front of such
 * a request does not render it, and each one has a sentence the requester can
 * act on rather than a silent no-op.
 */

export type RunnerGate =
  /** A browser, or a phone other than the one holding the originals. */
  | { kind: "wrong_device"; message: MessageKey }
  /** The right phone, but an app build that predates the manifest renderer. */
  | { kind: "update_app"; message: MessageKey }
  /** This device can and should render. */
  | { kind: "ready" };

export function gateForDevice(input: {
  isNative: boolean;
  canRenderManifest: boolean;
}): RunnerGate {
  if (!input.isNative) return { kind: "wrong_device", message: "deviceRender.openOnPhone" };
  if (!input.canRenderManifest) return { kind: "update_app", message: "deviceRender.updateApp" };
  return { kind: "ready" };
}

/**
 * Whether a tick should try to claim work.
 *
 * `visible` is not politeness. The server refuses a claim from a backgrounded
 * app — an encoder the OS is about to suspend would hold the lease and produce
 * nothing — so claiming while hidden burns a round trip to be told no.
 */
export function shouldAttemptRender(input: {
  gate: RunnerGate;
  paused: boolean;
  busy: boolean;
  visible: boolean;
  available: boolean;
}): boolean {
  return (
    input.gate.kind === "ready" &&
    !input.paused &&
    !input.busy &&
    input.visible &&
    input.available
  );
}

const PHASE_MESSAGES: Partial<Record<DeviceRenderPhase, MessageKey>> = {
  checking: "deviceRender.phase.checking",
  claiming: "deviceRender.phase.claiming",
  rendering: "deviceRender.phase.rendering",
  uploading: "deviceRender.phase.uploading",
  finishing: "deviceRender.phase.finishing",
  done: "deviceRender.phase.done",
};

export function phaseMessage(phase: DeviceRenderPhase): MessageKey | null {
  return PHASE_MESSAGES[phase] ?? null;
}

/**
 * A translated sentence for a refusal, where we have one.
 *
 * Returning null rather than inventing a key keeps an unknown reason honest:
 * the component falls back to showing the raw reason, which is more useful to
 * whoever is debugging it than a smooth sentence that says nothing.
 */
export function refusalMessage(reason?: string): MessageKey | null {
  if (!reason) return null;
  const known: MessageKey[] = [
    "deviceRender.reason.unsupported_encoder",
    "deviceRender.reason.insufficient_storage",
    "deviceRender.reason.app_not_foreground",
    "deviceRender.reason.low_power_mode",
    "deviceRender.reason.unsupported_app_build",
    "deviceRender.reason.no_render_queued",
    "deviceRender.reason.device_rendering_disabled",
  ];
  const candidate = `deviceRender.reason.${reason}` as MessageKey;
  return known.includes(candidate) ? candidate : null;
}

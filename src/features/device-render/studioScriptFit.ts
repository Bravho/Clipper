import type { StudioT } from "./studioText";

/**
 * The studio's script call on storyboard approval, and what happens when it
 * fails.
 *
 * Tho's rule (2026-10-26): when the AI fails the request does not pass
 * through. No empty or fallback script, no silent defaults, no guessed
 * business profile. The Sound step shows the error with a "Try again" button
 * that runs the same call again, and the voice cannot be made until it works.
 */

/** Where the speaking script is, from the studio's point of view. */
export type ScriptStatus =
  | "not_submitted"
  | "writing"
  /** A draft exists, but the script is written from the approved storyboard. */
  | "waiting_storyboard"
  /** The script call on storyboard approval failed: show the error and "Try again". */
  | "fit_failed"
  | "review"
  | "approved"
  | "failed";

export type ScriptFitFailureKind = "ai" | "timeout" | "network" | "invalid" | "server";

export class StudioScriptFitError extends Error {
  readonly kind: ScriptFitFailureKind;

  constructor(kind: ScriptFitFailureKind, message: string) {
    super(message);
    this.name = "StudioScriptFitError";
    this.kind = kind;
  }
}

export interface StoryboardScriptResult {
  scriptThai: string;
  sceneLines: string[];
  speakSeconds: number;
  /** Always present: an answer without a caption is a failure. */
  captionThai: string;
}

export interface StoryboardScriptRequest {
  requestId: string;
  jobId: string;
  scenes: { summary: string; shots: { assetIndex: number; seconds: number }[] }[];
  musicSelected: boolean;
}

/** A little longer than the server's own limit on the AI call (75 s). */
export const STUDIO_SCRIPT_FIT_TIMEOUT_MS = 90_000;

/** The code the fit-storyboard route answers with when the AI call failed. */
const AI_FAILED_CODE = "script_ai_failed";

/**
 * POST the approved storyboard to the fit-storyboard route and return the
 * script — or throw a `StudioScriptFitError`. Every way this can go wrong is a
 * throw: an error status, a timeout, a dropped connection, an answer that is
 * not JSON, or one without a script or caption.
 */
export async function requestStoryboardScript(
  input: StoryboardScriptRequest,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<StoryboardScriptResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? STUDIO_SCRIPT_FIT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`/api/requests/${input.requestId}/script/fit-storyboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: input.jobId,
        musicSelected: input.musicSelected,
        scenes: input.scenes,
      }),
      signal: controller.signal,
    });
  } catch (failure) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new StudioScriptFitError("timeout", "Writing the script took too long.");
    }
    throw new StudioScriptFitError(
      "network",
      failure instanceof Error ? failure.message : String(failure)
    );
  }
  clearTimeout(timer);

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    if (body?.code === AI_FAILED_CODE) {
      throw new StudioScriptFitError(body.reason === "timeout" ? "timeout" : "ai", message);
    }
    throw new StudioScriptFitError("server", message);
  }

  const scriptThai = typeof body?.scriptThai === "string" ? body.scriptThai.trim() : "";
  const captionThai = typeof body?.captionThai === "string" ? body.captionThai.trim() : "";
  if (!body || !scriptThai || !captionThai || !Array.isArray(body.sceneLines)) {
    throw new StudioScriptFitError("invalid", "The script answer was incomplete.");
  }
  return {
    scriptThai,
    captionThai,
    sceneLines: (body.sceneLines as unknown[]).map((line) => (typeof line === "string" ? line : "")),
    speakSeconds: typeof body.speakSeconds === "number" ? body.speakSeconds : 0,
  };
}

/** A failed script call as the Sound step shows it. */
export interface ScriptFitFailure {
  message: string;
  /**
   * True when the call ran because the storyboard was approved: the script
   * must come from this storyboard, so nothing can go on until it works. False
   * for the optional "rewrite" of a script that is already valid.
   */
  blocking: boolean;
}

/** The words for a failed script call. */
export function scriptFitFailureText(failure: unknown, t: StudioT, blocking: boolean): string {
  const kind = failure instanceof StudioScriptFitError ? failure.kind : "ai";
  if (!blocking) return t("studio.audio.fitFailedKeep");
  if (kind === "timeout") return t("studio.audio.fitFailedTimeout");
  if (kind === "network") return t("studio.audio.fitFailedNetwork");
  // A refusal that is not the AI's (no permission, wrong step…) is said as the
  // server said it; the AI's own failures get the plain explanation.
  if (kind === "server" && failure instanceof Error && failure.message) {
    return `${t("studio.audio.fitFailedTitle")}: ${failure.message}`;
  }
  return t("studio.audio.fitFailedBody");
}

/** What the Sound step shows for the script, given the pipeline and this session. */
export function studioScriptStatus(input: {
  pipeline: ScriptStatus;
  /** A script written from the storyboard exists (or was approved). */
  scriptReady: boolean;
  fitting: boolean;
  failure: ScriptFitFailure | null;
}): ScriptStatus {
  if (input.pipeline !== "review") return input.pipeline;
  if (input.fitting) return input.scriptReady ? "review" : "writing";
  if (input.failure?.blocking) return "fit_failed";
  return input.scriptReady ? "review" : "waiting_storyboard";
}

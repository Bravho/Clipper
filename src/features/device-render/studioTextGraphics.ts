import type { StudioT } from "./studioText";

/**
 * The studio's text-graphics call on the Graphic step, and what happens when
 * it fails.
 *
 * Rule (2026-10-27): when the AI fails, the preview shows an error with a
 * "Try again" button. The studio must never proceed to render with no/guessed
 * text graphics after a failure unless the requester explicitly chose "none".
 */

export type TextGraphicsFailureKind = "ai" | "timeout" | "network" | "server";

export class StudioTextGraphicsError extends Error {
  readonly kind: TextGraphicsFailureKind;

  constructor(kind: TextGraphicsFailureKind, message: string) {
    super(message);
    this.name = "StudioTextGraphicsError";
    this.kind = kind;
  }
}

/** Code the /api/device-render/text-graphics route returns when Claude fails. */
export const TEXT_GRAPHICS_AI_FAILED_CODE = "text_graphics_ai_failed";

/** A little longer than the server's own timeout on the AI call (50 s). */
export const STUDIO_GRAPHICS_TIMEOUT_MS = 65_000;

/** The words for a failed text-graphics call, shown under the "Try again" button. */
export function graphicsFailureText(failure: unknown, t: StudioT): string {
  const kind = failure instanceof StudioTextGraphicsError ? failure.kind : "ai";
  if (kind === "timeout") return t("studio.graphics.failedTimeout");
  if (kind === "server" && failure instanceof Error && failure.message) {
    return `${t("studio.graphics.failedTitle")}: ${failure.message}`;
  }
  return t("studio.graphics.failedBody");
}

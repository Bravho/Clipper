/**
 * What the storyboard script writer (the studio's script call on storyboard
 * approval) must hand back, and how its failures are named.
 *
 * Tho's rule (2026-10-26): when this AI call fails there is NO silent
 * fallback. The studio shows the error with a "Try again" button that runs the
 * same call again; nothing is saved from a failed or partial answer, and no
 * guessed business profile is written. Everything that counts as a failure is
 * thrown as a `StoryboardScriptError`, which the route turns into one
 * recognisable error code for the app.
 */

export type StoryboardScriptFailure = "ai_error" | "timeout" | "invalid_output";

export class StoryboardScriptError extends Error {
  readonly reason: StoryboardScriptFailure;

  constructor(message: string, reason: StoryboardScriptFailure) {
    super(message);
    this.name = "StoryboardScriptError";
    this.reason = reason;
  }
}

/** The error code the fit-storyboard route answers with for these failures. */
export const STORYBOARD_SCRIPT_ERROR_CODE = "script_ai_failed";

/** The business details the script writer extracts from the brief and pictures. */
export interface ExtractedBusinessProfile {
  /** "" when the requester gave no name (the model must not invent one). */
  businessName: string;
  category: string;
  location: string | null;
  description: string | null;
  menuDetails: string | null;
}

const MAX_FIELD = 500;

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, MAX_FIELD);
  return text && text.toLowerCase() !== "null" && text.toLowerCase() !== "n/a" ? text : null;
}

/**
 * The model's `businessProfile`, or null when it is missing or unusable
 * (not an object, or no category). A null here is an invalid answer — the
 * caller fails the call rather than saving something guessed.
 */
export function parseBusinessProfile(raw: unknown): ExtractedBusinessProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const category = optionalText(value.category);
  if (!category) return null;
  return {
    businessName: optionalText(value.businessName) ?? "",
    category,
    location: optionalText(value.location),
    description: optionalText(value.description),
    menuDetails: optionalText(value.menuDetails),
  };
}

/** Reject `promise` with a timeout failure after `ms`. */
export function withStoryboardScriptTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new StoryboardScriptError(`The script writer took longer than ${Math.round(ms / 1000)} s.`, "timeout")),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

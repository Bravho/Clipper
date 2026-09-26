/**
 * How long the picked material is, and how much of it the voice may use.
 *
 * WHY. The speaking script used to be written for the brief's target length,
 * so a request with 35 seconds of footage could get a 60-second script, and
 * the voice made from it could never be covered by the pictures. The studio
 * now sizes both the script and the voice to the MATERIAL: the clips' own
 * lengths plus a fixed time per photo, minus an allowance.
 *
 * Tho's numbers (26 Sep 2026):
 *   - a photo counts as 3 seconds (the length a photo shot gets by default);
 *   - the allowance is 5% of the material, and never less than 2 seconds —
 *     the video already adds 1.6 s around the voice (0.6 s intro + 1.0 s
 *     ending), so 2 s is the smallest allowance that still leaves the voice
 *     covered.
 *
 * The same numbers are used for the script target (server, at analysis), the
 * "Approve the voice" button (studio) and the approval check (server), so the
 * three can never disagree. Client-safe: no Node APIs, no repository imports.
 */

/** Seconds one photo counts for. */
export const PHOTO_MATERIAL_SECONDS = 3;

/** Allowance as a share of the material. */
export const MATERIAL_ALLOWANCE_SHARE = 0.05;

/** Smallest allowance, seconds. */
export const MATERIAL_ALLOWANCE_MIN_SECONDS = 2;

/** Shortest script target the server will ask for, seconds. */
export const MIN_SCRIPT_TARGET_SECONDS = 5;

export interface MaterialItem {
  /** A clip's length, or null/undefined for a photo. */
  durationSeconds?: number | null;
  /** True for a clip. When absent, an item with a length counts as a clip. */
  isClip?: boolean;
}

/** Total length of the picked material, seconds (one decimal). */
export function materialSeconds(items: readonly MaterialItem[]): number {
  let total = 0;
  for (const item of items) {
    const length = item.durationSeconds;
    const isClip = item.isClip ?? (typeof length === "number" && length > 0);
    if (isClip) {
      if (typeof length === "number" && Number.isFinite(length) && length > 0) total += length;
    } else {
      total += PHOTO_MATERIAL_SECONDS;
    }
  }
  return Math.round(total * 10) / 10;
}

/** The allowance for this much material, seconds. */
export function materialAllowanceSeconds(material: number): number {
  const safe = Number.isFinite(material) && material > 0 ? material : 0;
  return Math.max(MATERIAL_ALLOWANCE_MIN_SECONDS, safe * MATERIAL_ALLOWANCE_SHARE);
}

/**
 * The longest voice the material can carry, seconds (one decimal, rounded
 * down). Zero when there is too little material for any voice.
 */
export function maxVoiceSecondsForMaterial(material: number): number {
  const room = material - materialAllowanceSeconds(material);
  return room > 0 ? Math.floor(room * 10) / 10 : 0;
}

/**
 * The length the speaking script is written for: the voice limit, capped by
 * the product's longest video, and never shorter than a few seconds (a script
 * shorter than that is not a script; the voice check will then say plainly
 * that more material is needed).
 */
export function scriptTargetSeconds(material: number, maxVideoSeconds: number): number {
  const target = Math.min(maxVoiceSecondsForMaterial(material), maxVideoSeconds);
  return Math.max(MIN_SCRIPT_TARGET_SECONDS, Math.round(target));
}

/** Whether a voice of this length fits the material. */
export function voiceFitsMaterial(voiceSeconds: number, material: number): boolean {
  return voiceSeconds <= maxVoiceSecondsForMaterial(material) + 1e-6;
}

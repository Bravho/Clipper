import { createHash } from "node:crypto";

export { buildSpokenText } from "./spokenText";

/**
 * SHA-256 hex digest of the spoken text.
 * Used to detect script changes that would invalidate a cached voice/video.
 */
export function scriptHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Spaces key prefix for all avatar assets belonging to one draft. */
export function avatarKeyPrefix(userId: string, draftId: string): string {
  return `ad_lab/${userId}/avatar/${draftId}/`;
}

/**
 * Returns true when `key` sits inside the avatar prefix owned by this
 * user+draft pair. Used to prevent one user accessing another user's assets.
 */
export function isOwnAvatarKey(userId: string, draftId: string, key: string): boolean {
  return key.startsWith(avatarKeyPrefix(userId, draftId));
}

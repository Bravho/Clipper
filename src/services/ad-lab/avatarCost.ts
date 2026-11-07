/**
 * Avatar cost constants and estimation helpers.
 *
 * Sources (verified 2026-10-13):
 *   ElevenLabs v3 pricing: https://elevenlabs.io/pricing/api
 *   HeyGen pricing: developers.heygen.com/docs/pricing (checked 2026-10-13), UNCONFIRMED for this account
 *   Thai speech rate: assumption (13 chars ≈ 1 spoken second in Thai)
 */

/** ElevenLabs v3 per-1 000 input characters, USD. */
export const ELEVENLABS_V3_USD_PER_1K_CHARS = 0.08;

/**
 * HeyGen Avatar V (digital twin / studio_avatar / photo_avatar with avatar_v) per second, USD.
 * Also applies to avatar_iv when avatarType is digital_twin or studio_avatar.
 */
export const HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC = 0.0667;

/**
 * HeyGen Avatar IV per rendered second, USD.
 * Applies ONLY when engine=avatar_iv AND avatarType="photo_avatar".
 * digital_twin/studio_avatar with avatar_iv uses HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC.
 */
export const HEYGEN_AVATAR_IV_PHOTO_USD_PER_SEC = 0.05;

/** Approximate Thai characters spoken per second. */
export const THAI_CHARS_PER_SECOND = 13;

/** ElevenLabs v3 hard cap on input characters per request. */
export const ELEVENLABS_V3_MAX_CHARS = 5000;

/** Server-configurable avatar video length cap (seconds). Defaults to 180 s. */
export function avatarMaxSeconds(): number {
  const raw = process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS;
  if (!raw) return 180;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 180;
  return Math.max(10, Math.min(1800, n));
}

/** Estimated ElevenLabs v3 cost in USD for `chars` input characters. */
export function estimateVoiceCostUsd(chars: number): number {
  return (chars / 1000) * ELEVENLABS_V3_USD_PER_1K_CHARS;
}

/**
 * Estimated speech duration in seconds for a Thai script of `chars` characters.
 * `speed` is the ElevenLabs speed multiplier (0.7–1.2, default 1.0).
 * Higher speed → shorter audio: duration = base / speed.
 */
export function estimateSpeechSeconds(chars: number, speed = 1.0): number {
  return chars / THAI_CHARS_PER_SECOND / speed;
}

/**
 * Per-second HeyGen render rate for the given engine and avatarType.
 *   avatar_iv + photo_avatar → $0.05 / s
 *   everything else          → $0.0667 / s  (avatar_v any type, avatar_iv digital_twin/studio_avatar)
 */
export function avatarRatePerSec(
  engine: "avatar_v" | "avatar_iv",
  avatarType?: string
): number {
  if (engine === "avatar_iv" && avatarType === "photo_avatar") {
    return HEYGEN_AVATAR_IV_PHOTO_USD_PER_SEC;
  }
  return HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC;
}

/**
 * Estimated HeyGen cost in USD for a video of `seconds` duration.
 * Pass `avatarType` for accurate pricing when engine is avatar_iv:
 *   photo_avatar → $0.05/s;  digital_twin / studio_avatar → $0.0667/s.
 */
export function estimateAvatarVideoCostUsd(
  seconds: number,
  engine: "avatar_v" | "avatar_iv" = "avatar_v",
  avatarType?: string
): number {
  return seconds * avatarRatePerSec(engine, avatarType);
}

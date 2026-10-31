/**
 * LINE OA intake channel configuration.
 *
 * LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN are read only from env vars,
 * never hardcoded. Accessing them before they are set causes a 500 error so the
 * server never silently falls back to "no verification".
 */

export function getLineChannelSecret(): string {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) throw new Error('LINE_CHANNEL_SECRET is not configured');
  return secret;
}

export function getLineChannelAccessToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  return token;
}

/** Tolerance window for LINE webhook timestamp verification (seconds). */
export const LINE_WEBHOOK_SKEW_TOLERANCE_SECONDS = 300;

/** Max clip duration enforced for LINE intake (seconds). */
export const LINE_MAX_CLIP_DURATION_SECONDS = 90;

/** Max file size per upload (bytes). */
export const LINE_MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

/** Max files per request. */
export const LINE_MAX_FILES_PER_REQUEST = 20;

/** Pre-signed upload URL TTL (seconds). */
export const LINE_UPLOAD_PRESIGN_TTL_SECONDS = 15 * 60; // 15 minutes

/** Pre-signed GET URL TTL for LINE private assets (seconds). */
export const LINE_ASSET_SIGNED_URL_TTL_SECONDS = 30 * 60; // 30 minutes

/** Shop voice particle (ค่ะ / ครับ) – can be env-overridden. */
export function getShopVoiceParticle(): string {
  return process.env.SHOP_VOICE_PARTICLE ?? 'ค่ะ';
}

/** LINE reply base URL. */
export const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

/** LINE push base URL. */
export const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

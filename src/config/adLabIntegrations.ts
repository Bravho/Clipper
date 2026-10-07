/**
 * Optional Ad Lab integrations for Chinese_TTT cost-efficiency analysis.
 * All are read-only / draft-only. Missing env → stub mode (no network calls).
 * Ad Lab never charges cards or enables paid delivery from RClipper.
 */

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const AD_LAB_TIKTOK_MARKETING = {
  accessToken: env("TIKTOK_MARKETING_ACCESS_TOKEN") || env("TIKTOK_BUSINESS_ACCESS_TOKEN"),
  appId: env("TIKTOK_MARKETING_APP_ID"),
  appSecret: env("TIKTOK_MARKETING_APP_SECRET"),
  advertiserId: env("TIKTOK_MARKETING_ADVERTISER_ID"),
  apiBase: env("TIKTOK_MARKETING_API_BASE") || "https://business-api.tiktok.com/open_api/v1.3",
};

export const AD_LAB_LINE_OA = {
  channelAccessToken: env("AD_LAB_LINE_OA_CHANNEL_ACCESS_TOKEN") || env("LINE_OA_CHANNEL_ACCESS_TOKEN"),
  /** Optional override when the Messaging API friend-count endpoint needs a bot user id. */
  botUserId: env("AD_LAB_LINE_OA_BOT_USER_ID"),
};

export const AD_LAB_STRIPE_OUTCOMES = {
  /** Prefer a dedicated read key; falls back to the app Stripe secret (still read-only usage). */
  secretKey: env("AD_LAB_STRIPE_SECRET_KEY") || env("STRIPE_SECRET_KEY"),
  /** Only count PaymentIntents / charges whose metadata[key] matches this value. */
  metadataKey: env("AD_LAB_STRIPE_METADATA_KEY") || "product",
  metadataValue: env("AD_LAB_STRIPE_METADATA_VALUE") || "chinese_ttt",
};

export function tiktokMarketingConfigured(): boolean {
  return Boolean(AD_LAB_TIKTOK_MARKETING.accessToken && AD_LAB_TIKTOK_MARKETING.advertiserId);
}

export function lineOaConfigured(): boolean {
  return Boolean(AD_LAB_LINE_OA.channelAccessToken);
}

export function stripeOutcomesConfigured(): boolean {
  return Boolean(AD_LAB_STRIPE_OUTCOMES.secretKey);
}

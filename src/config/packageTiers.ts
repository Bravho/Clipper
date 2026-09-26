/**
 * The two package tiers (set 2026-09-27).
 *
 * Every package on sale includes BOTH video making and Channel Management
 * (unlimited publishing to the connected accounts) for its whole term. The tiers
 * differ only in how many videos each month is worth:
 *
 *   Starter  5 videos a month   1mo 190 · 3mo 540 · 6mo 1,030 · 12mo 1,890
 *   Pro     10 videos a month   1mo 350 · 3mo 990 · 6mo 1,890 · 12mo 3,490
 *
 * Why these numbers: every frame is now made on the requester's phone, so a
 * video costs the server only its AI calls (Gemini + ElevenLabs), storage and
 * publishing — about ฿3–5 typical and ฿25 at the per-request limits (see
 * config/requestLimits.ts). Starter is priced a little above half of Pro.
 *
 * The prices themselves live in config/management.ts (MANAGEMENT_PRODUCTS) and
 * the DB seed in migration 037; this file only names the tiers.
 */
export type PackageTier = "starter" | "pro";

/** Video requests per month, by tier. Unused requests do not carry over. */
export const PACKAGE_TIER_REQUESTS: Readonly<Record<PackageTier, number>> = {
  starter: 5,
  pro: 10,
};

export const PACKAGE_TIERS: readonly PackageTier[] = ["starter", "pro"];

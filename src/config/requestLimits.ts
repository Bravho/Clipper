/**
 * Per-request limits for a video made in the phone studio (set 2026-09-27).
 *
 * Every frame is rendered on the phone, so what a request costs the server is
 * its AI calls. The one that grows with use is ElevenLabs: each voice make is
 * billed per character of the script (≈ ฿1.3 for a 30 s voice, ≈ ฿4 for 90 s).
 * These limits cap the worst case at ≈ ฿25 per request (10 items, 88 s voice,
 * 3 makes, 4 shapes), so a Pro package stays profitable even when every video
 * is used to the maximum.
 *
 * ALL are enforced on the server (VideoGenerationService); the studio only
 * reflects them.
 */

/**
 * Voice makes per request: the first make plus two remakes. Counted from the
 * voice files ElevenLabs actually produced for the request, so a make that
 * failed (and cost nothing) is not counted.
 */
export const MAX_VOICE_MAKES_PER_REQUEST = 3;

/**
 * More voice makes, bought with credits once the included ones are used
 * (updated 2026-10-28; was +5 for 29cr, +5 for 49cr before that). Each
 * purchase adds `makes` to THIS request only; it is offered only when the
 * request has none left, so a double tap cannot buy two.
 *
 * COST OF 2 MORE MAKES (what the server pays):
 *   ElevenLabs eleven_v3 bills 1 credit per character; at a plan rate of
 *   ≈ $0.20 per 1,000 characters a Thai script reads ≈ 12 characters/second:
 *     typical 40 s voice ≈ 500 chars ≈ $0.10 ≈ ฿3.3 per make
 *     longest  88 s voice ≈ 1,080 chars ≈ $0.22 ≈ ฿7.1 per make
 *   + Gemini alignment / translation of the new voice ≈ ฿0.5–1 per make
 *   + storing the MP3 (≈ 1 MB) — under ฿0.1
 *   ⇒ 2 makes ≈ ฿6.6 typical, ≈ ฿14 worst case at 88 s.
 *
 * PRICE: 12 credits (฿12 on the web), above the ≈ ฿6.6 typical cost but below
 * the ≈ ฿14 worst case. Mobile top-ups are already priced for the store
 * commission (config/mobilePurchases.ts), so one price serves both.
 *
 * Changing the price needs no migration: the ledger stores what was charged.
 *
 * EXISTING BUYERS: production already has rows at amount=−49 (for +5 makes) and
 * amount=−29 (for +5 makes). Those buyers must not lose their makes. Allowances
 * are computed per ledger row via makesForTopUpAmount() below, which maps each
 * historical charge amount to the makes it originally granted.
 */
export const VOICE_MAKE_TOP_UP = {
  makes: 2,
  priceCredits: 12,
} as const;

/**
 * Legacy voice top-up amounts and the makes they granted, so existing buyers
 * keep what they paid for. Any unknown amount defaults to 5 makes — buyers
 * never lose makes from an unrecognised row.
 */
export const VOICE_MAKE_TOP_UP_LEGACY: ReadonlyArray<{
  amountCharged: number;
  makes: number;
}> = [
  { amountCharged: 49, makes: 5 },
  { amountCharged: 29, makes: 5 },
];

/**
 * How many makes one `credit_transactions` row of type `voice_make_top_up`
 * purchased. Resolves the current pack first, then the legacy table, then
 * defaults to 5 so an unrecognised historical row never costs a buyer makes.
 */
export function makesForTopUpAmount(absAmount: number): number {
  if (absAmount === VOICE_MAKE_TOP_UP.priceCredits) return VOICE_MAKE_TOP_UP.makes;
  const legacy = VOICE_MAKE_TOP_UP_LEGACY.find((r) => r.amountCharged === absAmount);
  return legacy?.makes ?? 5;
}

/**
 * One-time credit purchase to unlock download for a single free request for
 * VIDEO_DOWNLOAD_UNLOCK_DAYS days (set 2026-10-27).
 *
 * Channel Management is NOT included — only download. The unlock does not
 * count as a package in VideoAccessService.hasActivePackage(). The debit is
 * idempotent: a second call for the same user+request is a no-op.
 *
 * Changing the price needs no migration: the ledger stores what was charged.
 */
export const VIDEO_DOWNLOAD_UNLOCK = {
  priceCredits: 39,
  /** Days from purchase the download is available. */
  days: 30,
} as const;

/**
 * No going back after an approval. Once a step is approved (script → voice →
 * scene design → video), a phone-made request cannot be reopened or remade:
 * no "make the voice again" from the scene-design step, no "regenerate the
 * video", no re-captioning. Each channel shape (at most 4) is made once.
 */
export const LOCK_AFTER_APPROVAL = true;

/** Channel shapes a request can have: 9:16, 16:9, 4:5, 1:1 — each made once. */
export const MAX_CHANNEL_SHAPES_PER_REQUEST = 4;

/**
 * Per-request limits for a video made in the phone studio (set 2026-09-27).
 *
 * Every frame is rendered on the phone, so what a request costs the server is
 * its AI calls. The one that grows with use is ElevenLabs: each voice make is
 * billed per character of the script (≈ ฿1.3 for a 30 s voice, ≈ ฿4 for 90 s).
 * These limits cap the worst case at ≈ ฿25 per request (10 items, 88 s voice,
 * 5 makes, 4 shapes), so a Pro package stays profitable even when every video
 * is used to the maximum.
 *
 * ALL are enforced on the server (VideoGenerationService); the studio only
 * reflects them.
 */

/**
 * Voice makes per request: the first one plus four remakes. Counted from the
 * voice files ElevenLabs actually produced for the request, so a make that
 * failed (and cost nothing) is not counted.
 */
export const MAX_VOICE_MAKES_PER_REQUEST = 5;

/**
 * More voice makes, bought with credits once the included ones are used
 * (set 2026-10-11). Each purchase adds `makes` to THIS request only; it is
 * offered only when the request has none left, so a double tap cannot buy two.
 *
 * COST OF 5 MORE MAKES (what the server pays, ฿32.8 / USD):
 *   ElevenLabs eleven_v3 bills 1 credit per character; at a plan rate of
 *   ≈ $0.20 per 1,000 characters a Thai script reads ≈ 12 characters/second:
 *     typical 40 s voice ≈ 500 chars ≈ $0.10 ≈ ฿3.3 per make
 *     longest  88 s voice ≈ 1,080 chars ≈ $0.22 ≈ ฿7.1 per make
 *   + Gemini alignment / translation of the new voice ≈ ฿0.5–1 per make
 *   + storing the MP3 (≈ 1 MB) — under ฿0.1
 *   ⇒ 5 makes ≈ ฿20 typical, ≈ ฿40 worst case.
 *
 * PRICE: 49 credits (฿49 on the web). ≈ 2.4× cost on a typical script (≈ 58%
 * margin) and still above cost at the 88 s maximum, so a request that buys
 * pack after pack never loses money. Mobile top-ups are already priced for
 * the store commission (config/mobilePurchases.ts), so one price serves both.
 *
 * Changing the price needs no migration: the ledger stores what was charged.
 */
export const VOICE_MAKE_TOP_UP = {
  makes: 5,
  priceCredits: 49,
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

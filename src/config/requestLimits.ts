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
 * No going back after an approval. Once a step is approved (script → voice →
 * scene design → video), a phone-made request cannot be reopened or remade:
 * no "make the voice again" from the scene-design step, no "regenerate the
 * video", no re-captioning. Each channel shape (at most 4) is made once.
 */
export const LOCK_AFTER_APPROVAL = true;

/** Channel shapes a request can have: 9:16, 16:9, 4:5, 1:1 — each made once. */
export const MAX_CHANNEL_SHAPES_PER_REQUEST = 4;

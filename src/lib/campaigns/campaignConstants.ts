/**
 * Constants shared by the campaign manifest builder (server) and the app page
 * (client). Kept dependency-free so the client bundle stays small.
 */

/** The asset id of the customer's clip inside a campaign manifest. */
export const CAMPAIGN_CLIP_ASSET_ID = "campaign_clip";

/** The reserved staged-source key the native renderer reads the voice from. */
export const NATIVE_VOICE_KEY = "voice";

/** The manifest asset id of shot `index` (0-based): campaign_clip, campaign_clip_2, … */
export function shotAssetId(index: number): string {
  return index === 0 ? CAMPAIGN_CLIP_ASSET_ID : `${CAMPAIGN_CLIP_ASSET_ID}_${index + 1}`;
}

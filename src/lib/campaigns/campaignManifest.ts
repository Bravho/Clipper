/**
 * The Merchant Quick Video, as an ordinary v4 device-render manifest.
 *
 * No new renderer and no native change: this is one `final` stage, composed
 * from the original (`buildFromSources`, plugin v6), built by the SAME
 * `buildDeviceRenderManifest` the studio uses and checked by the same
 * `validateDeviceRenderManifest`. The phone renders it with `renderManifest`
 * and keeps the result; nothing is uploaded (`upload: null`).
 *
 *   picture   the customer's one clip, 9:16, played as shot (trim 0 → D)
 *   opening   text-graphics HOOK: category chip, merchant name, location
 *   middle    the customer's own sentence as captions
 *   ending    text-graphics CTA: "Friends get 5% off" + location + [CODE A7K4]
 *   look      the template's frame / decoration in the brand colour
 *
 * SOUND. The native from-sources path always mixes a "voice" track, and drops
 * the clip's own audio (`sourceClipAudio: false`). So:
 *   - a catalogue track is sent AS the voice (no music bed, no lead-in, so the
 *     picture and captions start at 0), cut to the picture length;
 *   - "clip sound" stages the customer's clip a second time under the
 *     reserved `voice` key, so the renderer mixes the clip's own sound in sync
 *     with its picture. `voiceUrl` still names a catalogue track: if the clip
 *     cannot be read as audio the app renders again WITHOUT staging it, and the
 *     phone downloads that track instead.
 * `voiceDurationSeconds` is the picture length, so the video is never longer
 * than the clip (the mixer stops reading the voice there).
 */
import {
  buildDeviceRenderManifest,
} from "@/lib/mobile/deviceRenderManifestBuilder";
import type { DeviceRenderManifest } from "@/lib/mobile/deviceRenderContract";
import {
  TEXT_GRAPHIC_LIMITS,
  clipText,
  graphemes,
  toManifestTextGraphics,
  type TextGraphicItem,
  type TextGraphicsPlan,
} from "@/lib/textGraphics/plan";
import { isTextGraphicStyleId } from "@/config/textGraphicStyles";
import { getTemplate } from "@/config/motionTemplates";
import { BACKGROUND_MUSIC_TRACKS, findMusicTrack, type MusicTrack } from "@/config/backgroundMusic";
import { CAMPAIGN_LIMITS } from "@/config/merchantCampaigns";
import { CAMPAIGN_CLIP_ASSET_ID } from "@/lib/campaigns/campaignConstants";
import {
  CLIP_SOUND_CHOICE,
  type CampaignTemplate,
  type Merchant,
  type MerchantCampaign,
} from "@/domain/models/MerchantCampaign";

export const CAMPAIGN_RENDER_STEP = "campaign_quick_video";
export { CAMPAIGN_CLIP_ASSET_ID };
const MAX_OUTPUT_BYTES = 250 * 1024 * 1024;

export interface CampaignClipInput {
  /** The app's own handle for the clip (never uploaded). */
  localId: string;
  mimeType: string;
  durationSeconds: number;
}

export interface BuildCampaignManifestInput {
  campaign: MerchantCampaign;
  merchant: Merchant;
  template: CampaignTemplate;
  creatorCampaignId: string;
  referralCode: string;
  clip: CampaignClipInput;
  statement: string;
  /** A catalogue track id or "clip_sound"; anything unknown → the template default. */
  soundChoice: string | null | undefined;
  /** Public origin the phone downloads fonts and music from. */
  origin: string;
  now?: Date;
}

export interface CampaignManifestResult {
  manifest: DeviceRenderManifest;
  /** Stage the clip again under the reserved "voice" key (keep the recorded sound). */
  useClipSound: boolean;
  /** The catalogue track named by `voiceUrl` (the music, or the clip-sound fallback). */
  musicTrackId: string;
  pictureSeconds: number;
}

/** Fill `{discount}`, `{code}`, `{merchant}`, `{location}` in an operator text. */
export function fillCampaignText(
  text: string,
  values: { discount: number; code: string; merchant: string; location: string }
): string {
  return text
    .replace(/\{discount\}/g, formatPercent(values.discount))
    .replace(/\{code\}/g, values.code)
    .replace(/\{merchant\}/g, values.merchant)
    .replace(/\{location\}/g, values.location);
}

export function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

/** The picture length: the clip, capped at the campaign maximum. */
export function campaignPictureSeconds(clipSeconds: number): number {
  if (!Number.isFinite(clipSeconds) || clipSeconds < CAMPAIGN_LIMITS.minClipSeconds) {
    throw new Error(`The clip must be at least ${CAMPAIGN_LIMITS.minClipSeconds} seconds long`);
  }
  return Math.round(Math.min(clipSeconds, CAMPAIGN_LIMITS.maxClipSeconds) * 100) / 100;
}

/** Resolve the customer's sound pick against the catalogue and the template. */
export function resolveCampaignSound(
  choice: string | null | undefined,
  template: Pick<CampaignTemplate, "defaultMusicTrackId">
): { useClipSound: boolean; track: MusicTrack } {
  const fallbackTrack =
    findMusicTrack(template.defaultMusicTrackId) ?? BACKGROUND_MUSIC_TRACKS[0];
  const pick = choice ?? template.defaultMusicTrackId;
  if (pick === CLIP_SOUND_CHOICE || pick === "none") {
    return { useClipSound: true, track: fallbackTrack };
  }
  const track = findMusicTrack(pick);
  if (track) return { useClipSound: false, track };
  // Unknown id: behave as the template says.
  if (template.defaultMusicTrackId === CLIP_SOUND_CHOICE) {
    return { useClipSound: true, track: fallbackTrack };
  }
  return { useClipSound: false, track: fallbackTrack };
}

/**
 * Split the sentence into caption cues across `[start, end]`: at most two
 * lines, broken at a space near the middle (Thai without spaces is cut by
 * characters), each cue at least ~1.6 s.
 */
export function statementCues(
  statement: string,
  start: number,
  end: number
): { startSecond: number; endSecond: number; text: string }[] {
  const text = clipText(statement, CAMPAIGN_LIMITS.statementMaxChars);
  if (!text || end - start < 0.8) return [];
  const chars = graphemes(text);
  const room = end - start;
  if (chars.length <= 42 || room < 3.2) {
    return [{ startSecond: start, endSecond: end, text }];
  }
  const middle = Math.floor(text.length / 2);
  let cut = -1;
  for (let offset = 0; offset < middle; offset++) {
    if (text[middle + offset] === " ") { cut = middle + offset; break; }
    if (text[middle - offset] === " ") { cut = middle - offset; break; }
  }
  let first: string;
  let second: string;
  if (cut > 0) {
    first = text.slice(0, cut).trim();
    second = text.slice(cut + 1).trim();
  } else {
    const half = Math.ceil(chars.length / 2);
    first = chars.slice(0, half).join("");
    second = chars.slice(half).join("");
  }
  const split = start + room * (graphemes(first).length / Math.max(1, chars.length));
  return [
    { startSecond: start, endSecond: split, text: first },
    { startSecond: split, endSecond: end, text: second },
  ];
}

/** Where the opening and closing cards sit on a picture of `seconds`. */
export function campaignCardTimes(seconds: number): {
  hook: { start: number; end: number };
  cta: { start: number; end: number };
} {
  const hookStart = 0.25;
  const hookEnd = Math.min(3.2, Math.max(hookStart + 1.4, seconds * 0.38));
  const ctaEnd = Math.max(hookEnd + 1.6, seconds - 0.05);
  const ctaStart = Math.max(hookEnd + TEXT_GRAPHIC_LIMITS.gapSeconds, seconds - 3.6);
  return {
    hook: { start: hookStart, end: round2(hookEnd) },
    cta: { start: round2(ctaStart), end: round2(Math.min(ctaEnd, seconds)) },
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyItem(kind: TextGraphicItem["kind"], start: number, end: number): TextGraphicItem {
  return { kind, start, end, title: "", sub: "", kicker: "", num: "", badge: "", brand: "", place: "", position: "" };
}

/** The two cards, in picture seconds. */
export function campaignTextGraphicItems(input: {
  template: CampaignTemplate;
  merchant: Merchant;
  campaign: MerchantCampaign;
  referralCode: string;
  pictureSeconds: number;
}): TextGraphicItem[] {
  const { template, merchant, campaign, referralCode } = input;
  const values = {
    discount: campaign.discountPercent,
    code: referralCode,
    merchant: merchant.name,
    location: merchant.location,
  };
  const times = campaignCardTimes(input.pictureSeconds);
  const L = TEXT_GRAPHIC_LIMITS;

  const hook = emptyItem("hook", times.hook.start, times.hook.end);
  hook.kicker = clipText(fillCampaignText(template.introKicker || merchant.category, values), L.kicker);
  hook.title = clipText(fillCampaignText(template.introTitle || merchant.name, values), L.title);
  hook.sub = clipText(fillCampaignText(template.introSub || merchant.location, values), L.sub);

  const cta = emptyItem("cta", times.cta.start, times.cta.end);
  const codeLabel = template.captionLanguage === "en" ? "CODE" : "โค้ด";
  cta.brand = clipText(
    fillCampaignText(
      template.ctaTitle || (template.captionLanguage === "en" ? "Friends get {discount}% off" : "เพื่อนรับส่วนลด {discount}%"),
      values
    ),
    L.brand
  );
  cta.place = clipText(fillCampaignText(template.ctaPlace || merchant.name, values), L.place);
  // The code always fits: it is the one thing a friend must be able to read.
  cta.title = clipText(`${codeLabel} ${referralCode}`, L.title);

  return [hook, cta].filter((item) => item.title || item.brand);
}

export function buildCampaignManifest(input: BuildCampaignManifestInput): CampaignManifestResult {
  const now = input.now ?? new Date();
  const seconds = campaignPictureSeconds(input.clip.durationSeconds);
  const { template, merchant, campaign } = input;
  const origin = input.origin.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(origin)) {
    throw new Error("The app origin is not configured (set NEXTAUTH_URL)");
  }

  const sound = resolveCampaignSound(input.soundChoice, template);
  const look = getTemplate(template.motionTemplateId);
  const accent = /^#[0-9a-fA-F]{6}$/.test(template.accentColor) ? template.accentColor : "#D7262E";
  const styleId = isTextGraphicStyleId(template.textStyleId) ? template.textStyleId : "premium";

  const items = campaignTextGraphicItems({
    template,
    merchant,
    campaign,
    referralCode: input.referralCode,
    pictureSeconds: seconds,
  });
  const plan: TextGraphicsPlan = {
    version: 1,
    choice: styleId,
    styleId,
    items,
    source: "fallback",
    fingerprint: `campaign:${campaign.id}:${template.id}:${template.updatedAt.getTime()}`,
    durationSeconds: seconds,
    createdAt: now.toISOString(),
  };
  const textGraphics = toManifestTextGraphics(plan, accent, origin);

  const times = campaignCardTimes(seconds);
  const captionEnd = times.cta.start - 0.1 > 1.5 ? times.cta.start - 0.1 : seconds - 0.1;
  const cues = statementCues(input.statement, 0.4, captionEnd);
  const language = template.captionLanguage === "en" ? "en" : "th";

  const manifest = buildDeviceRenderManifest({
    attemptId: `campaign_${input.creatorCampaignId}_${now.getTime()}`,
    taskId: input.creatorCampaignId,
    jobId: campaign.id,
    requestId: `campaign:${campaign.slug}`,
    step: CAMPAIGN_RENDER_STEP,
    stage: "final",
    ratio: "9:16",
    travy: false,
    buildFromSources: true,
    sources: [
      {
        assetId: CAMPAIGN_CLIP_ASSET_ID,
        kind: "clip",
        localId: input.clip.localId,
        mimeType: input.clip.mimeType.startsWith("video/") ? input.clip.mimeType : "video/mp4",
        durationSeconds: input.clip.durationSeconds,
      },
    ],
    scenes: [
      {
        sceneNumber: 1,
        transitionIn: "cut",
        assets: [
          {
            sourceAssetId: CAMPAIGN_CLIP_ASSET_ID,
            durationSeconds: seconds,
            motion: "static",
            trimStartSeconds: 0,
            trimEndSeconds: seconds,
            focusX: 0.5,
            focusY: 0.5,
            frameZoom: 1,
          },
        ],
      },
    ],
    voiceUrl: `${origin}${sound.track.url}`,
    voiceDurationSeconds: seconds,
    musicUrl: null,
    musicSelected: false,
    captions: cues.map((cue) => ({
      startSecond: cue.startSecond,
      endSecond: cue.endSecond,
      ...(language === "en" ? { textEnglish: cue.text } : { textThai: cue.text }),
    })),
    captionLanguages: [language],
    template: {
      id: look.id,
      frame: look.frame,
      canvas: look.canvas,
      decor: look.decor,
      palette: { primary: accent, secondary: "#FFFFFF", accent, neutral: "#111111" },
      beats: [],
      endSeconds: seconds,
    },
    textGraphics,
    upload: null,
    leaseExpiresAt: new Date(now.getTime() + 2 * 3600_000),
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });

  return {
    manifest,
    useClipSound: sound.useClipSound,
    musicTrackId: sound.track.id,
    pictureSeconds: seconds,
  };
}

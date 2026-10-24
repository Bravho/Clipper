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
import { CAMPAIGN_CLIP_ASSET_ID, shotAssetId } from "@/lib/campaigns/campaignConstants";
import {
  getStoryFormat,
  moodOf,
  type L2,
  type StoryFormat,
  type StoryMood,
} from "@/config/campaignStoryFormats";
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
  /** One clip per shot of the story format (one clip without a format). */
  clips: CampaignClipInput[];
  /** A story format id from the template's list, or null for the original single-clip video. */
  formatId?: string | null;
  /** Mood of the Day only: happy | chill | weekend. */
  moodId?: string | null;
  /** Today's Pick only: what the customer picked (the card title). */
  pick?: string | null;
  statement: string;
  /** A catalogue track id or "clip_sound"; anything unknown → the format/template default. */
  soundChoice: string | null | undefined;
  /** Public origin the phone downloads fonts and music from. */
  origin: string;
  now?: Date;
}

export interface CampaignManifestResult {
  manifest: DeviceRenderManifest;
  /** Stage the (single) clip again under the reserved "voice" key (keep the recorded sound). */
  useClipSound: boolean;
  /** The catalogue track named by `voiceUrl` (the music, or the clip-sound fallback). */
  musicTrackId: string;
  pictureSeconds: number;
  /** The manifest asset id each clip must be staged under, in shot order. */
  clipAssetIds: string[];
  formatId: string | null;
  moodId: string | null;
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

/** Fill a story-format text: {merchant} {location} {pick} {mood}. */
export function fillStoryText(
  text: string,
  values: { merchant: string; location: string; pick?: string; mood?: string }
): string {
  return text
    .replace(/\{merchant\}/g, values.merchant)
    .replace(/\{location\}/g, values.location)
    .replace(/\{pick\}/g, values.pick ?? "")
    .replace(/\{mood\}/g, values.mood ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

/** The picture length of the original single-clip video: the clip, capped. */
export function campaignPictureSeconds(clipSeconds: number): number {
  if (!Number.isFinite(clipSeconds) || clipSeconds < CAMPAIGN_LIMITS.minClipSeconds) {
    throw new Error(`The clip must be at least ${CAMPAIGN_LIMITS.minClipSeconds} seconds long`);
  }
  return round2(Math.min(clipSeconds, CAMPAIGN_LIMITS.maxClipSeconds));
}

/**
 * How long each shot plays: the clip, cut to the shot's maximum, never under
 * its minimum, and all together never over the campaign cap.
 */
export function shotSeconds(format: StoryFormat | null, clips: CampaignClipInput[]): number[] {
  if (!format) {
    if (clips.length !== 1) throw new Error("This video takes exactly one clip");
    return [campaignPictureSeconds(clips[0].durationSeconds)];
  }
  if (clips.length !== format.shots.length) {
    throw new Error(`This format takes ${format.shots.length} clip${format.shots.length > 1 ? "s" : ""}`);
  }
  const lengths = format.shots.map((shot, index) => {
    const seconds = clips[index].durationSeconds;
    if (!Number.isFinite(seconds) || seconds < shot.minSeconds) {
      throw new Error(`Clip ${index + 1} must be at least ${shot.minSeconds} seconds long`);
    }
    return Math.min(seconds, shot.maxSeconds);
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  const cap = CAMPAIGN_LIMITS.maxClipSeconds;
  const scale = total > cap ? cap / total : 1;
  return lengths.map((seconds) => round2(seconds * scale));
}

/**
 * Resolve the customer's sound pick. `defaultId` is the format's / mood's /
 * template's suggestion; the clip's own sound is only possible with ONE clip
 * (the renderer mixes a single "voice" track, so two clips' sounds cannot
 * both be kept in sync) — otherwise the suggested track is used.
 */
export function resolveCampaignSound(
  choice: string | null | undefined,
  defaultId: string,
  allowClipSound: boolean = true,
  fallbackTrackId?: string | null
): { useClipSound: boolean; track: MusicTrack } {
  const fallbackTrack =
    findMusicTrack(defaultId) ?? findMusicTrack(fallbackTrackId) ?? BACKGROUND_MUSIC_TRACKS[0];
  const wantsClip = (id: string | null | undefined) => id === CLIP_SOUND_CHOICE || id === "none";
  const pick = choice ?? defaultId;
  if (wantsClip(pick)) return { useClipSound: allowClipSound, track: fallbackTrack };
  const track = findMusicTrack(pick);
  if (track) return { useClipSound: false, track };
  return { useClipSound: allowClipSound && wantsClip(defaultId), track: fallbackTrack };
}

/** The sound the app pre-selects (and the server falls back to). */
export function defaultCampaignSound(
  template: Pick<CampaignTemplate, "defaultMusicTrackId">,
  format: StoryFormat | null,
  mood: StoryMood | null
): string {
  if (mood) return mood.musicTrackId;
  if (format && format.shots.length > 1) return format.musicTrackId;
  return template.defaultMusicTrackId || CLIP_SOUND_CHOICE;
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
export function campaignCardTimes(
  seconds: number,
  options: { revealAtEnd?: boolean } = {}
): {
  hook: { start: number; end: number };
  cta: { start: number; end: number };
} {
  const hookStart = 0.25;
  const hookEnd = Math.min(3.2, Math.max(hookStart + 1.4, seconds * 0.38));
  const ctaEnd = Math.max(hookEnd + 1.6, seconds - 0.05);
  // A reveal stays up a little longer: it is the punchline.
  const ctaLength = options.revealAtEnd ? 4.2 : 3.6;
  const ctaStart = Math.max(hookEnd + TEXT_GRAPHIC_LIMITS.gapSeconds, seconds - ctaLength);
  return {
    hook: { start: hookStart, end: round2(hookEnd) },
    cta: { start: round2(ctaStart), end: round2(Math.min(ctaEnd, seconds)) },
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyItem(kind: TextGraphicItem["kind"], start: number, end: number): TextGraphicItem {
  return { kind, start, end, title: "", sub: "", kicker: "", num: "", badge: "", brand: "", place: "", position: "" };
}

/**
 * The words on screen, in picture seconds — never more than three things:
 * the opening card (or, for Before & After, a small label per shot), the
 * customer's sentence (captions, not here) and the closing card with the code.
 */
export function campaignTextGraphicItems(input: {
  template: CampaignTemplate;
  merchant: Merchant;
  campaign: MerchantCampaign;
  referralCode: string;
  pictureSeconds: number;
  format?: StoryFormat | null;
  mood?: StoryMood | null;
  pick?: string | null;
  /** Each shot's length, in order (for shot labels). */
  shots?: number[];
}): TextGraphicItem[] {
  const { template, merchant, campaign, referralCode } = input;
  const format = input.format ?? null;
  const lang: keyof L2 = template.captionLanguage === "en" ? "en" : "th";
  const values = {
    discount: campaign.discountPercent,
    code: referralCode,
    merchant: merchant.name,
    location: merchant.location,
  };
  const story = {
    merchant: merchant.name,
    location: merchant.location,
    pick: clipText(input.pick ?? "", TEXT_GRAPHIC_LIMITS.title),
    mood: input.mood ? input.mood.title[lang] : "",
  };
  const times = campaignCardTimes(input.pictureSeconds, { revealAtEnd: format?.revealAtEnd });
  const L = TEXT_GRAPHIC_LIMITS;
  const items: TextGraphicItem[] = [];

  // Opening card.
  if (!format) {
    const hook = emptyItem("hook", times.hook.start, times.hook.end);
    hook.kicker = clipText(fillCampaignText(template.introKicker || merchant.category, values), L.kicker);
    hook.title = clipText(fillCampaignText(template.introTitle || merchant.name, values), L.title);
    hook.sub = clipText(fillCampaignText(template.introSub || merchant.location, values), L.sub);
    items.push(hook);
  } else if (format.hook) {
    const hook = emptyItem("hook", times.hook.start, times.hook.end);
    const own = (text: L2) => fillStoryText(text[lang], story);
    if (format.revealAtEnd) {
      // Nothing that names the shop before the end.
      hook.kicker = clipText(own(format.hook.kicker), L.kicker);
      hook.title = clipText(own(format.hook.title), L.title);
      hook.sub = clipText(own(format.hook.sub), L.sub);
    } else {
      hook.kicker = clipText(
        own(format.hook.kicker) || fillCampaignText(template.introKicker || merchant.category, values),
        L.kicker
      );
      hook.title = clipText(
        own(format.hook.title) || fillCampaignText(template.introTitle || merchant.name, values),
        L.title
      );
      hook.sub = clipText(
        own(format.hook.sub) || fillCampaignText(template.introSub || merchant.location, values),
        L.sub
      );
    }
    if (hook.title || hook.kicker) items.push(hook);
  }

  // Small shot labels (Before / After) — only where they fit before the closing card.
  if (format && input.shots && format.shots.some((shot) => shot.label)) {
    let shotStart = 0;
    format.shots.forEach((shot, index) => {
      const length = input.shots?.[index] ?? 0;
      if (shot.label) {
        const start = round2(shotStart + 0.15);
        const end = round2(
          Math.min(shotStart + 2.2, shotStart + length - 0.1, times.cta.start - L.gapSeconds)
        );
        if (end - start >= 1) {
          const label = emptyItem("label", start, end);
          label.title = clipText(shot.label[lang], L.title);
          if (index === 0 && !format.hook) label.sub = clipText(merchant.name, L.sub);
          items.push(label);
        }
      }
      shotStart += length;
    });
  }

  // Closing card: the offer and the code (and, for Guess Where I Am, the answer).
  const cta = emptyItem("cta", times.cta.start, times.cta.end);
  const codeLabel = lang === "en" ? "CODE" : "โค้ด";
  const offer = fillCampaignText(
    template.ctaTitle || (lang === "en" ? "Friends get {discount}% off" : "เพื่อนรับส่วนลด {discount}%"),
    values
  );
  if (format?.revealAtEnd) {
    cta.brand = clipText(lang === "en" ? `It's ${merchant.name}!` : `เฉลย: ${merchant.name}`, L.brand);
    cta.place = clipText(offer, L.place);
  } else {
    cta.brand = clipText(offer, L.brand);
    cta.place = clipText(fillCampaignText(template.ctaPlace || merchant.name, values), L.place);
  }
  // The code always fits: it is the one thing a friend must be able to read.
  cta.title = clipText(`${codeLabel} ${referralCode}`, L.title);
  items.push(cta);

  return items.filter((item) => item.title || item.brand || item.kicker);
}

export function buildCampaignManifest(input: BuildCampaignManifestInput): CampaignManifestResult {
  const now = input.now ?? new Date();
  const { template, merchant, campaign } = input;
  const format = input.formatId ? getStoryFormat(input.formatId) : null;
  if (input.formatId && !format) throw new Error("Unknown video format");
  const mood = moodOf(format, input.moodId);
  const lengths = shotSeconds(format, input.clips);
  const seconds = round2(lengths.reduce((a, b) => a + b, 0));
  const origin = input.origin.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(origin)) {
    throw new Error("The app origin is not configured (set NEXTAUTH_URL)");
  }

  const sound = resolveCampaignSound(
    input.soundChoice,
    defaultCampaignSound(template, format, mood),
    input.clips.length === 1,
    format?.musicTrackId ?? template.defaultMusicTrackId
  );
  // The shop's look — except Mood of the Day, where the mood IS the look.
  const look = getTemplate(mood?.motionTemplateId ?? template.motionTemplateId);
  const accent = /^#[0-9a-fA-F]{6}$/.test(template.accentColor) ? template.accentColor : "#D7262E";
  const wantedStyle = mood?.textStyleId ?? template.textStyleId;
  const styleId = isTextGraphicStyleId(wantedStyle) ? wantedStyle : "premium";

  const items = campaignTextGraphicItems({
    template,
    merchant,
    campaign,
    referralCode: input.referralCode,
    pictureSeconds: seconds,
    format,
    mood,
    pick: input.pick,
    shots: lengths,
  });
  const plan: TextGraphicsPlan = {
    version: 1,
    choice: styleId,
    styleId,
    items,
    source: "fallback",
    fingerprint: `campaign:${campaign.id}:${template.id}:${template.updatedAt.getTime()}:${format?.id ?? "classic"}`,
    durationSeconds: seconds,
    createdAt: now.toISOString(),
  };
  const textGraphics = toManifestTextGraphics(plan, accent, origin);

  const times = campaignCardTimes(seconds, { revealAtEnd: format?.revealAtEnd });
  const captionEnd = times.cta.start - 0.1 > 1.5 ? times.cta.start - 0.1 : seconds - 0.1;
  const statement = fillStoryText(input.statement, {
    merchant: merchant.name,
    location: merchant.location,
    pick: input.pick ?? "",
    mood: mood ? mood.title[template.captionLanguage === "en" ? "en" : "th"] : "",
  });
  const cues = statementCues(statement, 0.4, captionEnd);
  const language = template.captionLanguage === "en" ? "en" : "th";

  const clipAssetIds = input.clips.map((_, index) => shotAssetId(index));
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
    sources: input.clips.map((clip, index) => ({
      assetId: clipAssetIds[index],
      kind: "clip" as const,
      localId: clip.localId,
      mimeType: clip.mimeType.startsWith("video/") ? clip.mimeType : "video/mp4",
      durationSeconds: clip.durationSeconds,
    })),
    scenes: input.clips.map((_, index) => ({
      sceneNumber: index + 1,
      transitionIn: index === 0 ? ("cut" as const) : ("fade" as const),
      assets: [
        {
          sourceAssetId: clipAssetIds[index],
          durationSeconds: lengths[index],
          motion: "static" as const,
          trimStartSeconds: 0,
          trimEndSeconds: Math.min(lengths[index], input.clips[index].durationSeconds),
          focusX: 0.5,
          focusY: 0.5,
          frameZoom: 1,
        },
      ],
    })),
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
    clipAssetIds,
    formatId: format?.id ?? null,
    moodId: mood?.id ?? null,
  };
}

import type { IMerchantCampaignRepository } from "@/repositories/interfaces/IMerchantCampaignRepository";
import {
  CLIP_SOUND_CHOICE,
  type CampaignCreator,
  type CampaignTemplate,
  type CreatorCampaign,
  type CreatorSocialPost,
  type Merchant,
  type MerchantCampaign,
  type SocialPlatform,
} from "@/domain/models/MerchantCampaign";
import { CAMPAIGN_LIMITS } from "@/config/merchantCampaigns";
import { BACKGROUND_MUSIC_TRACKS } from "@/config/backgroundMusic";
import {
  generateReferralCode,
  hashInstallId,
  isCampaignSlug,
  isInstallId,
  normalizeReferralCode,
  qrKeyMatches,
} from "@/lib/campaigns/referralCode";
import {
  buildCampaignManifest,
  defaultCampaignSound,
  fillCampaignText,
  fillStoryText,
  formatPercent,
  type CampaignClipInput,
  type CampaignManifestResult,
} from "@/lib/campaigns/campaignManifest";
import {
  formatMaxSeconds,
  getStoryFormat,
  normalizeStoryFormatList,
  type StoryFormatId,
} from "@/config/campaignStoryFormats";
import { CAMPAIGN_OTP, REFERRAL_CODE_LENGTH } from "@/config/merchantCampaigns";
import { CampaignError } from "@/services/campaigns/CampaignErrors";
import { hashPhone, maskPhone, newOtpCode, hashOtp, normalizePhone, otpMatches } from "@/lib/campaigns/phone";
import { getSmsProvider, type SmsProvider } from "@/lib/sms";
import { itravyClient as defaultItravyClient, type ItravyClient } from "@/lib/campaigns/itravyClient";
import { randomUUID } from "crypto";

/**
 * The customer side of a Merchant Referral Campaign — no login.
 *
 * Every call names the campaign by its slug AND the QR key printed with it,
 * so the page only works from a scanned QR, and the phone's random install id
 * (sent as a header) — the server keeps only its peppered hash.
 */

export interface CampaignAccess {
  slug: string;
  qrKey: string | null | undefined;
}

/** What the request tells us about the creator's phone, for iTravy's weak self-referral flag. */
export interface RequestSignals {
  ip?: string | null;
  userAgent?: string | null;
}

export interface CampaignCreatorDeps {
  itravy?: ItravyClient;
  sms?: () => SmsProvider | null;
}

export interface OtpSent {
  challengeId: string;
  maskedPhone: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface ResolvedCampaign {
  campaign: MerchantCampaign;
  merchant: Merchant;
  template: CampaignTemplate;
}

/** What the customer's phone is shown about the campaign (never the QR key). */
export interface PublicCampaignView {
  slug: string;
  title: string;
  merchant: { name: string; category: string; location: string };
  discountPercent: number;
  discountLabel: string;
  rewardDescription: string;
  rewardCooldownDays: number;
  defaultStatement: string;
  defaultSound: string;
  captionLanguage: "th" | "en";
  sounds: { id: string; label: string; url: string; mood?: string }[];
  limits: { minClipSeconds: number; maxClipSeconds: number; statementMaxChars: number };
  endsAt: string | null;
  /**
   * The story formats this shop offers (max 4), in the shop's order. Empty =
   * the original single-clip video. Names, descriptions and shot prompts are
   * `campaign.format.<id>.*` keys in the app's own language; everything here
   * that ends up IN the video is already in the template's caption language.
   */
  formats: PublicStoryFormat[];
}

export interface PublicStoryFormat {
  id: StoryFormatId;
  icon: string;
  shots: { minSeconds: number; maxSeconds: number }[];
  maxSeconds: number;
  asksPick: boolean;
  /** The pre-filled sentence (shop name filled in). */
  defaultStatement: string;
  /** The pre-selected sound. */
  defaultSound: string;
  /** "Sound from my video" is offered (one clip only). */
  allowsClipSound: boolean;
  revealAtEnd: boolean;
  moods: { id: string; defaultStatement: string; defaultSound: string }[];
}

export interface CreatorCampaignStatus {
  creatorId: string;
  referralCode: string;
  videosMade: number;
  reward: {
    lastGrantedAt: string | null;
    /** Null when a reward can be claimed now. */
    nextEligibleAt: string | null;
    cooldownDays: number;
  };
  posts: { platform: SocialPlatform; url: string; createdAt: string }[];
  phone: {
    /** The campaign asks for a verified phone before the video. */
    required: boolean;
    /** A code can be sent (an SMS provider is configured). */
    available: boolean;
    /** Nothing more to do: verified (and given to iTravy when linked), or not required. */
    ok: boolean;
    /** Last four digits of the verified phone, for "verified ••5678". */
    last4: string | null;
  };
  itravy: {
    /** The campaign is linked to an iTravy campaign (friends can redeem). */
    linked: boolean;
    /** iTravy has accepted this creator's code. */
    registered: boolean;
  };
}

export interface RewardClaimResult {
  granted: boolean;
  claimedAt: string;
  referralCode: string;
  rewardDescription: string;
  lastGrantedAt: string | null;
  nextEligibleAt: string | null;
}

/** iTravy's view of a code (server-to-server, `/api/travy/referral-codes/:code`). */
export interface PartnerReferralCodeView {
  code: string;
  valid: boolean;
  reason: "ok" | "campaign_not_live" | "campaign_ended" | "campaign_not_started";
  creatorId: string;
  merchant: { id: string; name: string; location: string };
  campaign: {
    id: string;
    title: string;
    status: string;
    discountPercent: number;
    startsAt: string | null;
    endsAt: string | null;
  };
  issuedAt: string;
}

const POST_HOSTS: { platform: SocialPlatform; hosts: string[] }[] = [
  { platform: "facebook", hosts: ["facebook.com", "fb.com", "fb.watch", "m.facebook.com"] },
  { platform: "instagram", hosts: ["instagram.com", "instagr.am"] },
  { platform: "tiktok", hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"] },
];

/** Accept only an http(s) link; label it by host. */
export function parsePostUrl(raw: unknown): { url: string; platform: SocialPlatform } | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > CAMPAIGN_LIMITS.postUrlMaxLength) return null;
  // People paste "Check this out https://…" from the share sheet.
  const match = trimmed.match(/https?:\/\/\S+/i);
  let url: URL;
  try {
    url = new URL(match ? match[0] : trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const known = POST_HOSTS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  return { url: url.toString(), platform: known?.platform ?? "other" };
}

function isLiveNow(campaign: MerchantCampaign, now: Date): PartnerReferralCodeView["reason"] {
  if (campaign.status === "ended" || (campaign.endsAt && campaign.endsAt.getTime() <= now.getTime())) {
    return "campaign_ended";
  }
  if (campaign.status !== "live") return "campaign_not_live";
  if (campaign.startsAt && campaign.startsAt.getTime() > now.getTime()) return "campaign_not_started";
  return "ok";
}

function smsText(lang: string | null | undefined, code: string): string {
  switch ((lang ?? "").toLowerCase()) {
    case "en":
      return `Your RClipper code is ${code}. Valid for 5 minutes. Do not share it.`;
    case "vi":
      return `Mã RClipper của bạn là ${code}, có hiệu lực 5 phút. Không chia sẻ mã này.`;
    default:
      return `รหัส RClipper ของคุณคือ ${code} ใช้ได้ 5 นาที ห้ามบอกรหัสนี้กับผู้อื่น`;
  }
}

export class CampaignCreatorService {
  private readonly itravy: ItravyClient;
  private readonly sms: () => SmsProvider | null;

  constructor(
    private readonly repo: IMerchantCampaignRepository,
    private readonly clock: () => Date = () => new Date(),
    deps: CampaignCreatorDeps = {}
  ) {
    this.itravy = deps.itravy ?? defaultItravyClient;
    this.sms = deps.sms ?? getSmsProvider;
  }

  /**
   * Does this creator still need to verify a phone for this campaign?
   *
   * Phone verified, and — when the campaign is linked to iTravy — that phone
   * handed to iTravy (which keeps its own hash per creator and refuses it as
   * a redeemer). With no SMS provider configured the step is skipped, like
   * iTravy does, so the shop keeps working (and it is logged at startup).
   */
  private phoneOk(campaign: MerchantCampaign, creator: CampaignCreator): boolean {
    if (!campaign.requirePhoneOtp) return true;
    if (!this.sms()) return true;
    if (!creator.phoneVerifiedAt || !creator.phoneHash) return false;
    return campaign.itravyCampaignId ? Boolean(creator.itravyPhoneSyncedAt) : true;
  }

  /**
   * Make sure iTravy knows this creator's code (so friends can redeem it).
   * Idempotent on iTravy's side per (campaign, creator). Sends RClipper's own
   * code: the code in the video must be the code iTravy redeems.
   */
  private async registerWithItravy(
    campaign: MerchantCampaign,
    creator: CampaignCreator,
    entry: CreatorCampaign,
    signals: RequestSignals,
    creatorPhone: string | null = null
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!campaign.itravyCampaignId) return { ok: true };
    const result = await this.itravy.registerCode({
      campaignId: campaign.itravyCampaignId,
      creatorId: creator.id,
      code: entry.referralCode,
      installHash: creator.installHash,
      creatorIp: signals.ip ?? null,
      creatorUserAgent: signals.userAgent ?? null,
      creatorPhone,
    });
    if (!result.ok || !result.data) {
      const reason = result.reason ?? "ITRAVY_FAILED";
      await this.repo.setItravyError(entry.id, reason).catch(() => undefined);
      return { ok: false, reason };
    }
    if (result.data.code !== entry.referralCode) {
      // iTravy already holds a different code for this creator — the video
      // would show a code that does not redeem. Never silently continue.
      await this.repo.setItravyError(entry.id, `CODE_MISMATCH:${result.data.code}`).catch(() => undefined);
      return { ok: false, reason: "CODE_MISMATCH" };
    }
    const now = this.clock();
    await this.repo.markItravyRegistered(entry.id, now);
    if (creatorPhone) await this.repo.markCreatorPhoneSynced(creator.id, now);
    return { ok: true };
  }

  /** The campaign behind a scanned QR, or a specific refusal. */
  async resolve(access: CampaignAccess): Promise<ResolvedCampaign> {
    if (!isCampaignSlug(access.slug)) throw new CampaignError("not_found", "Campaign not found", 404);
    const campaign = await this.repo.findCampaignBySlug(access.slug);
    if (!campaign) throw new CampaignError("not_found", "Campaign not found", 404);
    if (!qrKeyMatches(access.qrKey, campaign.qrKey)) {
      throw new CampaignError("bad_key", "Please scan the QR code at the shop again.", 403);
    }
    const state = isLiveNow(campaign, this.clock());
    if (state === "campaign_ended") throw new CampaignError("ended", "This campaign has ended.", 410);
    if (state !== "ok") throw new CampaignError("not_live", "This campaign is not open yet.", 409);
    const [merchant, template] = await Promise.all([
      this.repo.findMerchant(campaign.merchantId),
      this.repo.findTemplate(campaign.templateId),
    ]);
    if (!merchant || !template || merchant.status !== "active") {
      throw new CampaignError("not_found", "Campaign not found", 404);
    }
    return { campaign, merchant, template };
  }

  publicView({ campaign, merchant, template }: ResolvedCampaign): PublicCampaignView {
    const values = {
      discount: campaign.discountPercent,
      code: "",
      merchant: merchant.name,
      location: merchant.location,
    };
    return {
      slug: campaign.slug,
      title: campaign.title,
      merchant: { name: merchant.name, category: merchant.category, location: merchant.location },
      discountPercent: campaign.discountPercent,
      discountLabel: formatPercent(campaign.discountPercent),
      rewardDescription: campaign.rewardDescription,
      rewardCooldownDays: campaign.rewardCooldownDays,
      defaultStatement: fillCampaignText(template.defaultStatement, values),
      defaultSound: template.defaultMusicTrackId || CLIP_SOUND_CHOICE,
      captionLanguage: template.captionLanguage,
      sounds: BACKGROUND_MUSIC_TRACKS.map((t) => ({ id: t.id, label: t.label, url: t.url, mood: t.mood })),
      limits: {
        minClipSeconds: CAMPAIGN_LIMITS.minClipSeconds,
        maxClipSeconds: CAMPAIGN_LIMITS.maxClipSeconds,
        statementMaxChars: CAMPAIGN_LIMITS.statementMaxChars,
      },
      endsAt: campaign.endsAt ? campaign.endsAt.toISOString() : null,
      formats: this.publicFormats(merchant, template),
    };
  }

  private publicFormats(merchant: Merchant, template: CampaignTemplate): PublicStoryFormat[] {
    const lang = template.captionLanguage === "en" ? "en" : "th";
    const story = { merchant: merchant.name, location: merchant.location };
    return normalizeStoryFormatList(template.storyFormats).map((id) => {
      const format = getStoryFormat(id)!;
      return {
        id,
        icon: format.icon,
        shots: format.shots.map((shot) => ({ minSeconds: shot.minSeconds, maxSeconds: shot.maxSeconds })),
        maxSeconds: formatMaxSeconds(format, CAMPAIGN_LIMITS.maxClipSeconds),
        asksPick: Boolean(format.asksPick),
        defaultStatement: fillStoryText(format.defaultStatement[lang], story),
        defaultSound: defaultCampaignSound(template, format, null),
        allowsClipSound: format.shots.length === 1,
        revealAtEnd: Boolean(format.revealAtEnd),
        moods: (format.moods ?? []).map((mood) => ({
          id: mood.id,
          defaultStatement: fillStoryText(mood.defaultStatement[lang], story),
          defaultSound: mood.musicTrackId,
        })),
      };
    });
  }

  private installHashOf(installId: unknown): string {
    if (!isInstallId(installId)) {
      throw new CampaignError("bad_install", "This app needs to be updated to join campaigns.", 400);
    }
    return hashInstallId(installId);
  }

  /**
   * POST creator/session (+ referral-code): find or create the anonymous
   * creator for this phone and its entry (and code) in this campaign.
   */
  async startSession(
    access: CampaignAccess,
    installId: unknown,
    platform: CampaignCreator["platform"],
    signals: RequestSignals = {}
  ): Promise<{ resolved: ResolvedCampaign; creator: CampaignCreator; entry: CreatorCampaign; status: CreatorCampaignStatus }> {
    const installHash = this.installHashOf(installId);
    const resolved = await this.resolve(access);
    const creator = await this.repo.upsertCreator(installHash, platform);
    const entry = await this.repo.getOrCreateCreatorCampaign({
      creatorId: creator.id,
      campaignId: resolved.campaign.id,
      merchantId: resolved.campaign.merchantId,
      // Four characters; after a run of collisions, five.
      nextCode: (attempt) => generateReferralCode(attempt < 12 ? REFERRAL_CODE_LENGTH : REFERRAL_CODE_LENGTH + 1),
    });
    // Tell iTravy early (best effort; retried — and required — before the video).
    let current = entry;
    if (resolved.campaign.itravyCampaignId && !entry.itravyRegisteredAt) {
      const registered = await this.registerWithItravy(resolved.campaign, creator, entry, signals).catch(
        () => ({ ok: false as const, reason: "ITRAVY_UNREACHABLE" })
      );
      if (registered.ok) current = { ...entry, itravyRegisteredAt: this.clock(), itravyError: null };
    }
    const status = await this.statusFor(resolved.campaign, creator, current, installHash);
    return { resolved, creator, entry: current, status };
  }

  /** The creator's entry, which must already exist (session first). */
  private async requireEntry(access: CampaignAccess, installId: unknown) {
    const installHash = this.installHashOf(installId);
    const resolved = await this.resolve(access);
    const creator = await this.repo.findCreatorByInstallHash(installHash);
    const entry = creator ? await this.repo.findCreatorCampaign(creator.id, resolved.campaign.id) : null;
    if (!creator || !entry) {
      throw new CampaignError("no_session", "Open the campaign from its QR code first.", 409);
    }
    return { installHash, resolved, creator, entry };
  }

  async status(access: CampaignAccess, installId: unknown): Promise<CreatorCampaignStatus> {
    const { installHash, resolved, creator, entry } = await this.requireEntry(access, installId);
    return this.statusFor(resolved.campaign, creator, entry, installHash);
  }

  private async statusFor(
    campaign: MerchantCampaign,
    creator: CampaignCreator,
    entry: CreatorCampaign,
    installHash: string
  ): Promise<CreatorCampaignStatus> {
    const [last, posts] = await Promise.all([
      this.repo.lastGrantedClaim(installHash, campaign.id, creator.phoneHash),
      this.repo.listSocialPosts(entry.id),
    ]);
    return {
      creatorId: creator.id,
      referralCode: entry.referralCode,
      videosMade: entry.videosMade,
      reward: {
        lastGrantedAt: last ? last.claimedAt.toISOString() : null,
        nextEligibleAt: this.nextEligible(last?.claimedAt ?? null, campaign.rewardCooldownDays),
        cooldownDays: campaign.rewardCooldownDays,
      },
      posts: posts.map((p: CreatorSocialPost) => ({
        platform: p.socialPlatform,
        url: p.postUrl,
        createdAt: p.createdAt.toISOString(),
      })),
      phone: {
        required: campaign.requirePhoneOtp,
        available: this.sms() !== null,
        ok: this.phoneOk(campaign, creator),
        last4: creator.phoneVerifiedAt ? creator.phoneLast4 : null,
      },
      itravy: {
        linked: Boolean(campaign.itravyCampaignId),
        registered: Boolean(entry.itravyRegisteredAt),
      },
    };
  }

  // ── Creator phone OTP ──────────────────────────────────────────────────────

  /**
   * Send a 6-digit code to the creator's phone. Throttled per install and per
   * phone (durably, in the database) before anything is sent, so a script
   * cannot run up the SMS bill.
   */
  async requestOtp(
    access: CampaignAccess,
    installId: unknown,
    rawPhone: unknown,
    lang?: string | null
  ): Promise<OtpSent> {
    const { installHash } = await this.requireEntry(access, installId);
    const provider = this.sms();
    if (!provider) throw new CampaignError("otp_unavailable", "Phone codes cannot be sent right now.", 503);
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new CampaignError("phone_invalid", "Enter a mobile number, e.g. 081 234 5678.", 400);
    const phoneHash = hashPhone(phone);
    const now = this.clock();

    const stats = await this.repo.otpSendStats({ installHash, phoneHash, now });
    if (stats.secondsSinceLast != null && stats.secondsSinceLast < CAMPAIGN_OTP.resendCooldownSeconds) {
      const retryAfter = CAMPAIGN_OTP.resendCooldownSeconds - stats.secondsSinceLast;
      throw new CampaignError("otp_cooldown", "Please wait before asking for another code.", 429, {
        retryAfterSeconds: retryAfter,
      });
    }
    if (
      stats.byInstall >= CAMPAIGN_OTP.maxSendsPerInstallPerHour ||
      stats.byPhone >= CAMPAIGN_OTP.maxSendsPerPhonePerHour
    ) {
      throw new CampaignError("rate_limited", "Too many codes. Please try again in an hour.", 429, {
        retryAfterSeconds: 3600,
      });
    }

    const challengeId = randomUUID();
    const code = newOtpCode();
    await this.repo.createOtp({
      id: challengeId,
      installHash,
      phoneHash,
      phoneLast4: phone.slice(-4),
      codeHash: hashOtp(challengeId, code),
      expiresAt: new Date(now.getTime() + CAMPAIGN_OTP.ttlSeconds * 1000),
      createdAt: now,
    });
    try {
      await provider.send({ to: phone, text: smsText(lang, code) });
    } catch (error) {
      console.error("[campaign] SMS send failed:", error instanceof Error ? error.message : error);
      await this.repo.expireOtp(challengeId, now).catch(() => undefined);
      throw new CampaignError("sms_failed", "The code could not be sent. Please try again.", 502);
    }
    return {
      challengeId,
      maskedPhone: maskPhone(phone),
      expiresInSeconds: CAMPAIGN_OTP.ttlSeconds,
      resendAfterSeconds: CAMPAIGN_OTP.resendCooldownSeconds,
    };
  }

  /**
   * Check the code. On success the phone becomes this creator's verified
   * phone and — when the campaign is linked — is handed to iTravy with the
   * creator's code (iTravy stores only its own hash of it). If iTravy cannot
   * be reached the code is NOT used up: the creator just taps Verify again.
   *
   * `rawPhone` is the number the code was sent to; it is re-checked against
   * the challenge's hash, so a different number cannot be slipped in.
   */
  async verifyOtp(
    access: CampaignAccess,
    installId: unknown,
    input: { challengeId: unknown; code: unknown; phone: unknown },
    signals: RequestSignals = {}
  ): Promise<CreatorCampaignStatus> {
    const { installHash, resolved, creator, entry } = await this.requireEntry(access, installId);
    if (typeof input.challengeId !== "string") {
      throw new CampaignError("otp_not_found", "Ask for a new code.", 404);
    }
    const otp = await this.repo.findOtp(input.challengeId);
    const phone = normalizePhone(input.phone);
    if (!otp || otp.installHash !== installHash || !phone || hashPhone(phone) !== otp.phoneHash) {
      throw new CampaignError("otp_not_found", "Ask for a new code.", 404);
    }
    const now = this.clock();
    if (!otp.verifiedAt) {
      if (otp.expiresAt.getTime() <= now.getTime()) {
        throw new CampaignError("otp_expired", "The code has expired. Ask for a new one.", 410);
      }
      if (otp.attempts >= CAMPAIGN_OTP.maxAttempts) {
        throw new CampaignError("otp_locked", "Too many wrong codes. Ask for a new one.", 423);
      }
      if (!otpMatches(otp.id, input.code, otp.codeHash)) {
        const attempts = await this.repo.bumpOtpAttempts(otp.id);
        const left = Math.max(0, CAMPAIGN_OTP.maxAttempts - attempts);
        throw new CampaignError(
          left > 0 ? "otp_invalid" : "otp_locked",
          left > 0 ? "That code is not right." : "Too many wrong codes. Ask for a new one.",
          left > 0 ? 400 : 423,
          { attemptsLeft: left }
        );
      }
    }

    // The code is right. Hand the phone to iTravy first; only then use it up.
    const verifiedCreator =
      (await this.repo.setCreatorPhone(creator.id, {
        phoneHash: otp.phoneHash,
        phoneLast4: otp.phoneLast4,
        verifiedAt: otp.verifiedAt ?? now,
      })) ?? creator;
    if (resolved.campaign.itravyCampaignId) {
      const registered = await this.registerWithItravy(
        resolved.campaign,
        verifiedCreator,
        entry,
        signals,
        phone
      );
      if (!registered.ok) {
        throw new CampaignError(
          "itravy_failed",
          "Could not confirm your number with iTravy. Please tap Verify again.",
          502,
          { reason: registered.reason }
        );
      }
    }
    if (!otp.verifiedAt) await this.repo.markOtpVerified(otp.id, now);

    const fresh = (await this.repo.findCreator(creator.id)) ?? verifiedCreator;
    const freshEntry = (await this.repo.findCreatorCampaign(creator.id, resolved.campaign.id)) ?? entry;
    return this.statusFor(resolved.campaign, fresh, freshEntry, installHash);
  }

  private nextEligible(lastGrantedAt: Date | null, cooldownDays: number): string | null {
    if (!lastGrantedAt) return null;
    const next = lastGrantedAt.getTime() + cooldownDays * 86_400_000;
    return next > this.clock().getTime() ? new Date(next).toISOString() : null;
  }

  /** The manifest the phone renders (small JSON; nothing heavy on the server). */
  async renderManifest(
    access: CampaignAccess,
    installId: unknown,
    body: {
      localId?: unknown;
      mimeType?: unknown;
      durationSeconds?: unknown;
      statement?: unknown;
      sound?: unknown;
      /** Story format id (must be one the shop offers). */
      format?: unknown;
      /** One entry per shot: { localId, mimeType, durationSeconds }. */
      shots?: unknown;
      mood?: unknown;
      pick?: unknown;
    },
    origin: string,
    signals: RequestSignals = {}
  ): Promise<CampaignManifestResult> {
    const { resolved, creator, entry } = await this.requireEntry(access, installId);
    // The video carries the code, so the code must be one iTravy will honour —
    // and refuse to the creator's own (verified) phone.
    if (!this.phoneOk(resolved.campaign, creator)) {
      throw new CampaignError("phone_required", "Verify your phone number first.", 428);
    }
    if (resolved.campaign.itravyCampaignId && !entry.itravyRegisteredAt) {
      const registered = await this.registerWithItravy(resolved.campaign, creator, entry, signals);
      if (!registered.ok) {
        throw new CampaignError(
          "itravy_failed",
          "Your code could not be registered with iTravy. Please try again.",
          502,
          { reason: registered.reason }
        );
      }
    }
    // Which story: one the shop offers, or — when it offers none — the original video.
    const offered = normalizeStoryFormatList(resolved.template.storyFormats);
    let formatId: StoryFormatId | null = null;
    if (offered.length > 0) {
      formatId = offered.find((id) => id === body.format) ?? null;
      if (!formatId) {
        throw new CampaignError("invalid", "Choose one of the shop's video styles.", 400);
      }
    }
    const format = getStoryFormat(formatId);
    const rawShots = Array.isArray(body.shots)
      ? body.shots
      : [{ localId: body.localId, mimeType: body.mimeType, durationSeconds: body.durationSeconds }];
    const expected = format ? format.shots.length : 1;
    if (rawShots.length !== expected) {
      throw new CampaignError("invalid", `This video style needs ${expected} clip${expected > 1 ? "s" : ""}.`, 400);
    }
    const clips: CampaignClipInput[] = rawShots.map((raw, index) => {
      const shot = (raw ?? {}) as Record<string, unknown>;
      const durationSeconds = Number(shot.durationSeconds);
      const min = format ? format.shots[index].minSeconds : CAMPAIGN_LIMITS.minClipSeconds;
      if (!Number.isFinite(durationSeconds) || durationSeconds < min) {
        throw new CampaignError(
          "invalid",
          expected > 1
            ? `Clip ${index + 1} must be at least ${min} seconds long.`
            : `The clip must be at least ${min} seconds long.`,
          400
        );
      }
      const localId = typeof shot.localId === "string" && /^[\w.:-]{1,120}$/.test(shot.localId)
        ? shot.localId
        : `campaign-clip-${index + 1}`;
      const mimeType = typeof shot.mimeType === "string" && shot.mimeType.startsWith("video/")
        ? shot.mimeType.slice(0, 60)
        : "video/mp4";
      return { localId, mimeType, durationSeconds };
    });
    try {
      return buildCampaignManifest({
        ...resolved,
        creatorCampaignId: entry.id,
        referralCode: entry.referralCode,
        clips,
        formatId,
        moodId: typeof body.mood === "string" ? body.mood : null,
        pick: typeof body.pick === "string" ? body.pick : null,
        statement: typeof body.statement === "string" ? body.statement : "",
        soundChoice: typeof body.sound === "string" ? body.sound : null,
        origin,
        now: this.clock(),
      });
    } catch (error) {
      throw new CampaignError("invalid", error instanceof Error ? error.message : "Cannot build the video", 400);
    }
  }

  /** The phone finished a render (for the operator's "videos made" count). */
  async recordVideoMade(access: CampaignAccess, installId: unknown): Promise<{ videosMade: number }> {
    const { entry } = await this.requireEntry(access, installId);
    const updated = await this.repo.recordVideoMade(entry.id, this.clock());
    return { videosMade: updated?.videosMade ?? entry.videosMade };
  }

  /** "Show staff": grant the creator reward unless this device is in cooldown. */
  async claimReward(access: CampaignAccess, installId: unknown): Promise<RewardClaimResult> {
    const { installHash, resolved, creator, entry } = await this.requireEntry(access, installId);
    const now = this.clock();
    const { claim, lastGranted } = await this.repo.claimReward({
      creatorCampaign: entry,
      installHash,
      phoneHash: creator.phoneVerifiedAt ? creator.phoneHash : null,
      cooldownDays: resolved.campaign.rewardCooldownDays,
      now,
    });
    const granted = claim.status === "granted";
    const lastAt = granted ? claim.claimedAt : lastGranted?.claimedAt ?? null;
    return {
      granted,
      claimedAt: claim.claimedAt.toISOString(),
      referralCode: entry.referralCode,
      rewardDescription: resolved.campaign.rewardDescription,
      lastGrantedAt: lastAt ? lastAt.toISOString() : null,
      nextEligibleAt: this.nextEligible(lastAt, resolved.campaign.rewardCooldownDays),
    };
  }

  /** Optional: the link of the published post. */
  async addSocialPost(
    access: CampaignAccess,
    installId: unknown,
    rawUrl: unknown
  ): Promise<{ platform: SocialPlatform; url: string }> {
    const { entry } = await this.requireEntry(access, installId);
    const parsed = parsePostUrl(rawUrl);
    if (!parsed) throw new CampaignError("invalid", "Paste the link of your post.", 400);
    const existing = await this.repo.listSocialPosts(entry.id);
    if (
      existing.length >= CAMPAIGN_LIMITS.maxPostsPerCreatorCampaign &&
      !existing.some((p) => p.postUrl === parsed.url)
    ) {
      throw new CampaignError("limit", "You have already added the most links for this campaign.", 429);
    }
    const post = await this.repo.addSocialPost({
      creatorCampaign: entry,
      socialPlatform: parsed.platform,
      postUrl: parsed.url,
    });
    return { platform: post.socialPlatform, url: post.postUrl };
  }

  /** iTravy (server-to-server): is this code real, and what does it unlock? */
  async lookupCode(rawCode: unknown): Promise<PartnerReferralCodeView | null> {
    const code = normalizeReferralCode(rawCode);
    if (!code) return null;
    const entry = await this.repo.findCreatorCampaignByCode(code);
    if (!entry) return null;
    const [campaign, merchant] = await Promise.all([
      this.repo.findCampaign(entry.campaignId),
      this.repo.findMerchant(entry.merchantId),
    ]);
    if (!campaign || !merchant) return null;
    const reason = isLiveNow(campaign, this.clock());
    return {
      code: entry.referralCode,
      valid: reason === "ok",
      reason,
      creatorId: entry.creatorId,
      merchant: { id: merchant.id, name: merchant.name, location: merchant.location },
      campaign: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        discountPercent: campaign.discountPercent,
        startsAt: campaign.startsAt ? campaign.startsAt.toISOString() : null,
        endsAt: campaign.endsAt ? campaign.endsAt.toISOString() : null,
      },
      issuedAt: entry.createdAt.toISOString(),
    };
  }
}

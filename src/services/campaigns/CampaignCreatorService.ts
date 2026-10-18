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
  fillCampaignText,
  formatPercent,
  type CampaignManifestResult,
} from "@/lib/campaigns/campaignManifest";
import { REFERRAL_CODE_LENGTH } from "@/config/merchantCampaigns";
import { CampaignError } from "@/services/campaigns/CampaignErrors";

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

export class CampaignCreatorService {
  constructor(
    private readonly repo: IMerchantCampaignRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

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
    };
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
    platform: CampaignCreator["platform"]
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
    const status = await this.statusFor(resolved.campaign, creator, entry, installHash);
    return { resolved, creator, entry, status };
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
      this.repo.lastGrantedClaim(installHash, campaign.id),
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
    };
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
    body: { localId?: unknown; mimeType?: unknown; durationSeconds?: unknown; statement?: unknown; sound?: unknown },
    origin: string
  ): Promise<CampaignManifestResult> {
    const { resolved, entry } = await this.requireEntry(access, installId);
    const durationSeconds = Number(body.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds < CAMPAIGN_LIMITS.minClipSeconds) {
      throw new CampaignError(
        "invalid",
        `The clip must be at least ${CAMPAIGN_LIMITS.minClipSeconds} seconds long.`,
        400
      );
    }
    const localId = typeof body.localId === "string" && /^[\w.:-]{1,120}$/.test(body.localId)
      ? body.localId
      : "campaign-clip";
    const mimeType = typeof body.mimeType === "string" && body.mimeType.startsWith("video/")
      ? body.mimeType.slice(0, 60)
      : "video/mp4";
    try {
      return buildCampaignManifest({
        ...resolved,
        creatorCampaignId: entry.id,
        referralCode: entry.referralCode,
        clip: { localId, mimeType, durationSeconds },
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
    const { installHash, resolved, entry } = await this.requireEntry(access, installId);
    const now = this.clock();
    const { claim, lastGranted } = await this.repo.claimReward({
      creatorCampaign: entry,
      installHash,
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

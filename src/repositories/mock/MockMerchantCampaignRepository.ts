import { randomUUID } from "crypto";
import type { IMerchantCampaignRepository } from "@/repositories/interfaces/IMerchantCampaignRepository";
import type {
  CampaignCreator,
  CampaignStats,
  CampaignTemplate,
  CreateCampaignTemplateInput,
  CreateMerchantCampaignInput,
  CreateMerchantInput,
  CreatorCampaign,
  CreatorRewardClaim,
  CreatorSocialPost,
  Merchant,
  MerchantCampaign,
  SocialPlatform,
  UpdateCampaignTemplateInput,
  UpdateMerchantCampaignInput,
  UpdateMerchantInput,
} from "@/domain/models/MerchantCampaign";

/** Everything the mock keeps; tests pass a fresh one (or nothing). */
export interface MerchantCampaignStore {
  merchants: Map<string, Merchant>;
  templates: Map<string, CampaignTemplate>;
  campaigns: Map<string, MerchantCampaign>;
  creators: Map<string, CampaignCreator>;
  creatorCampaigns: Map<string, CreatorCampaign>;
  claims: Map<string, CreatorRewardClaim>;
  posts: Map<string, CreatorSocialPost>;
}

export function emptyMerchantCampaignStore(): MerchantCampaignStore {
  return {
    merchants: new Map(),
    templates: new Map(),
    campaigns: new Map(),
    creators: new Map(),
    creatorCampaigns: new Map(),
    claims: new Map(),
    posts: new Map(),
  };
}

const copy = <T extends object>(value: T): T => ({ ...value });

/** In-memory Merchant Referral Campaigns, for tests. */
export class MockMerchantCampaignRepository implements IMerchantCampaignRepository {
  constructor(private readonly s: MerchantCampaignStore = emptyMerchantCampaignStore()) {}

  async createMerchant(input: CreateMerchantInput): Promise<Merchant> {
    const now = new Date();
    const merchant: Merchant = { ...input, id: `mer_${randomUUID()}`, status: "active", createdAt: now, updatedAt: now };
    this.s.merchants.set(merchant.id, merchant);
    return copy(merchant);
  }

  async updateMerchant(id: string, updates: UpdateMerchantInput): Promise<Merchant | null> {
    const found = this.s.merchants.get(id);
    if (!found) return null;
    const next = { ...found, ...updates, updatedAt: new Date() };
    this.s.merchants.set(id, next);
    return copy(next);
  }

  async findMerchant(id: string): Promise<Merchant | null> {
    const found = this.s.merchants.get(id);
    return found ? copy(found) : null;
  }

  async listMerchants(): Promise<Merchant[]> {
    return [...this.s.merchants.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(copy);
  }

  async createTemplate(input: CreateCampaignTemplateInput): Promise<CampaignTemplate> {
    const now = new Date();
    const template: CampaignTemplate = { ...input, id: `tpl_${randomUUID()}`, createdAt: now, updatedAt: now };
    this.s.templates.set(template.id, template);
    return copy(template);
  }

  async updateTemplate(id: string, updates: UpdateCampaignTemplateInput): Promise<CampaignTemplate | null> {
    const found = this.s.templates.get(id);
    if (!found) return null;
    const next = { ...found, ...updates, updatedAt: new Date() };
    this.s.templates.set(id, next);
    return copy(next);
  }

  async findTemplate(id: string): Promise<CampaignTemplate | null> {
    const found = this.s.templates.get(id);
    return found ? copy(found) : null;
  }

  async listTemplates(merchantId?: string): Promise<CampaignTemplate[]> {
    return [...this.s.templates.values()]
      .filter((t) => !merchantId || t.merchantId === merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(copy);
  }

  async createCampaign(input: CreateMerchantCampaignInput): Promise<MerchantCampaign> {
    if ([...this.s.campaigns.values()].some((c) => c.slug === input.slug)) {
      throw new Error("duplicate campaign slug");
    }
    const now = new Date();
    const campaign: MerchantCampaign = {
      ...input,
      id: `cmp_${randomUUID()}`,
      status: "draft",
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.s.campaigns.set(campaign.id, campaign);
    return copy(campaign);
  }

  async updateCampaign(id: string, updates: UpdateMerchantCampaignInput): Promise<MerchantCampaign | null> {
    const found = this.s.campaigns.get(id);
    if (!found) return null;
    const next = { ...found, ...updates, updatedAt: new Date() };
    this.s.campaigns.set(id, next);
    return copy(next);
  }

  async findCampaign(id: string): Promise<MerchantCampaign | null> {
    const found = this.s.campaigns.get(id);
    return found ? copy(found) : null;
  }

  async findCampaignBySlug(slug: string): Promise<MerchantCampaign | null> {
    const found = [...this.s.campaigns.values()].find((c) => c.slug === slug);
    return found ? copy(found) : null;
  }

  async listCampaigns(merchantId?: string): Promise<MerchantCampaign[]> {
    return [...this.s.campaigns.values()]
      .filter((c) => !merchantId || c.merchantId === merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(copy);
  }

  async campaignStats(campaignIds: string[]): Promise<CampaignStats[]> {
    return campaignIds.map((campaignId) => {
      const entries = [...this.s.creatorCampaigns.values()].filter((c) => c.campaignId === campaignId);
      const claims = [...this.s.claims.values()].filter((c) => c.campaignId === campaignId);
      return {
        campaignId,
        creators: entries.length,
        videosMade: entries.reduce((sum, c) => sum + c.videosMade, 0),
        rewardsGranted: claims.filter((c) => c.status === "granted").length,
        rewardsRefused: claims.filter((c) => c.status === "rejected_limit").length,
        postLinks: [...this.s.posts.values()].filter((p) => p.campaignId === campaignId).length,
      };
    });
  }

  async upsertCreator(installHash: string, platform: CampaignCreator["platform"]): Promise<CampaignCreator> {
    const existing = [...this.s.creators.values()].find((c) => c.installHash === installHash);
    const now = new Date();
    if (existing) {
      const next = { ...existing, lastSeenAt: now, platform: platform ?? existing.platform };
      this.s.creators.set(existing.id, next);
      return copy(next);
    }
    const creator: CampaignCreator = { id: `crt_${randomUUID()}`, installHash, platform, createdAt: now, lastSeenAt: now };
    this.s.creators.set(creator.id, creator);
    return copy(creator);
  }

  async findCreatorByInstallHash(installHash: string): Promise<CampaignCreator | null> {
    const found = [...this.s.creators.values()].find((c) => c.installHash === installHash);
    return found ? copy(found) : null;
  }

  async findCreatorCampaign(creatorId: string, campaignId: string): Promise<CreatorCampaign | null> {
    const found = [...this.s.creatorCampaigns.values()].find(
      (c) => c.creatorId === creatorId && c.campaignId === campaignId
    );
    return found ? copy(found) : null;
  }

  async getOrCreateCreatorCampaign(input: {
    creatorId: string;
    campaignId: string;
    merchantId: string;
    nextCode: (attempt: number) => string;
  }): Promise<CreatorCampaign> {
    const existing = await this.findCreatorCampaign(input.creatorId, input.campaignId);
    if (existing) return existing;
    const taken = new Set([...this.s.creatorCampaigns.values()].map((c) => c.referralCode));
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = input.nextCode(attempt);
      if (taken.has(code)) continue;
      const entry: CreatorCampaign = {
        id: `cc_${randomUUID()}`,
        creatorId: input.creatorId,
        campaignId: input.campaignId,
        merchantId: input.merchantId,
        referralCode: code,
        videosMade: 0,
        lastVideoAt: null,
        createdAt: new Date(),
      };
      this.s.creatorCampaigns.set(entry.id, entry);
      return copy(entry);
    }
    throw new Error("Could not allocate a unique referral code");
  }

  async findCreatorCampaignByCode(code: string): Promise<CreatorCampaign | null> {
    const found = [...this.s.creatorCampaigns.values()].find((c) => c.referralCode === code);
    return found ? copy(found) : null;
  }

  async recordVideoMade(creatorCampaignId: string, at: Date): Promise<CreatorCampaign | null> {
    const found = this.s.creatorCampaigns.get(creatorCampaignId);
    if (!found) return null;
    const next = { ...found, videosMade: found.videosMade + 1, lastVideoAt: at };
    this.s.creatorCampaigns.set(found.id, next);
    return copy(next);
  }

  async claimReward(input: {
    creatorCampaign: CreatorCampaign;
    installHash: string;
    cooldownDays: number;
    now: Date;
  }): Promise<{ claim: CreatorRewardClaim; lastGranted: CreatorRewardClaim | null }> {
    const lastGranted = await this.lastGrantedClaim(input.installHash, input.creatorCampaign.campaignId);
    const windowStart = input.now.getTime() - input.cooldownDays * 86_400_000;
    const blocked = lastGranted != null && lastGranted.claimedAt.getTime() > windowStart;
    const claim: CreatorRewardClaim = {
      id: `rwc_${randomUUID()}`,
      creatorCampaignId: input.creatorCampaign.id,
      creatorId: input.creatorCampaign.creatorId,
      campaignId: input.creatorCampaign.campaignId,
      merchantId: input.creatorCampaign.merchantId,
      installHash: input.installHash,
      referralCode: input.creatorCampaign.referralCode,
      status: blocked ? "rejected_limit" : "granted",
      claimedAt: input.now,
    };
    this.s.claims.set(claim.id, claim);
    return { claim: copy(claim), lastGranted };
  }

  async lastGrantedClaim(installHash: string, campaignId: string): Promise<CreatorRewardClaim | null> {
    const found = [...this.s.claims.values()]
      .filter((c) => c.installHash === installHash && c.campaignId === campaignId && c.status === "granted")
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime())[0];
    return found ? copy(found) : null;
  }

  async addSocialPost(input: {
    creatorCampaign: CreatorCampaign;
    socialPlatform: SocialPlatform;
    postUrl: string;
  }): Promise<CreatorSocialPost> {
    const existing = [...this.s.posts.values()].find(
      (p) => p.creatorCampaignId === input.creatorCampaign.id && p.postUrl === input.postUrl
    );
    if (existing) return copy(existing);
    const post: CreatorSocialPost = {
      id: `post_${randomUUID()}`,
      creatorCampaignId: input.creatorCampaign.id,
      creatorId: input.creatorCampaign.creatorId,
      campaignId: input.creatorCampaign.campaignId,
      merchantId: input.creatorCampaign.merchantId,
      socialPlatform: input.socialPlatform,
      postUrl: input.postUrl,
      referralCode: input.creatorCampaign.referralCode,
      createdAt: new Date(),
    };
    this.s.posts.set(post.id, post);
    return copy(post);
  }

  async listSocialPosts(creatorCampaignId: string): Promise<CreatorSocialPost[]> {
    return [...this.s.posts.values()]
      .filter((p) => p.creatorCampaignId === creatorCampaignId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(copy);
  }
}

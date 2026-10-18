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

/** Data access for Merchant Referral Campaigns (migration 043). */
export interface IMerchantCampaignRepository {
  // ── Operator side ──────────────────────────────────────────────────────────
  createMerchant(input: CreateMerchantInput): Promise<Merchant>;
  updateMerchant(id: string, updates: UpdateMerchantInput): Promise<Merchant | null>;
  findMerchant(id: string): Promise<Merchant | null>;
  listMerchants(): Promise<Merchant[]>;

  createTemplate(input: CreateCampaignTemplateInput): Promise<CampaignTemplate>;
  updateTemplate(id: string, updates: UpdateCampaignTemplateInput): Promise<CampaignTemplate | null>;
  findTemplate(id: string): Promise<CampaignTemplate | null>;
  listTemplates(merchantId?: string): Promise<CampaignTemplate[]>;

  createCampaign(input: CreateMerchantCampaignInput): Promise<MerchantCampaign>;
  updateCampaign(id: string, updates: UpdateMerchantCampaignInput): Promise<MerchantCampaign | null>;
  findCampaign(id: string): Promise<MerchantCampaign | null>;
  findCampaignBySlug(slug: string): Promise<MerchantCampaign | null>;
  listCampaigns(merchantId?: string): Promise<MerchantCampaign[]>;
  campaignStats(campaignIds: string[]): Promise<CampaignStats[]>;

  // ── Customer side (no login) ───────────────────────────────────────────────
  /** Find the creator for an install hash, creating it on first sight. */
  upsertCreator(installHash: string, platform: CampaignCreator["platform"]): Promise<CampaignCreator>;
  findCreatorByInstallHash(installHash: string): Promise<CampaignCreator | null>;

  findCreatorCampaign(creatorId: string, campaignId: string): Promise<CreatorCampaign | null>;
  /**
   * The creator's entry in a campaign, created with a fresh code on first
   * call. `nextCode(attempt)` is asked again when a code is already taken by
   * anyone; the stored code is never changed afterwards.
   */
  getOrCreateCreatorCampaign(input: {
    creatorId: string;
    campaignId: string;
    merchantId: string;
    nextCode: (attempt: number) => string;
  }): Promise<CreatorCampaign>;
  findCreatorCampaignByCode(code: string): Promise<CreatorCampaign | null>;
  recordVideoMade(creatorCampaignId: string, at: Date): Promise<CreatorCampaign | null>;

  /**
   * Atomically: grant a reward unless this device already got one from this
   * campaign within `cooldownDays`, and record the attempt either way.
   */
  claimReward(input: {
    creatorCampaign: CreatorCampaign;
    installHash: string;
    cooldownDays: number;
    now: Date;
  }): Promise<{ claim: CreatorRewardClaim; lastGranted: CreatorRewardClaim | null }>;
  /** Most recent GRANTED claim by this device in this campaign. */
  lastGrantedClaim(installHash: string, campaignId: string): Promise<CreatorRewardClaim | null>;

  addSocialPost(input: {
    creatorCampaign: CreatorCampaign;
    socialPlatform: SocialPlatform;
    postUrl: string;
  }): Promise<CreatorSocialPost>;
  listSocialPosts(creatorCampaignId: string): Promise<CreatorSocialPost[]>;
}

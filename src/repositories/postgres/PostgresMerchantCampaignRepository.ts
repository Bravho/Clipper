import { randomUUID } from "crypto";
import { pool } from "@/lib/db";
import type { IMerchantCampaignRepository } from "@/repositories/interfaces/IMerchantCampaignRepository";
import type {
  CampaignCreator,
  CampaignStats,
  CampaignStatus,
  CampaignTemplate,
  CreateCampaignTemplateInput,
  CreateMerchantCampaignInput,
  CreateMerchantInput,
  CreatorCampaign,
  CreatorRewardClaim,
  CreatorSocialPost,
  Merchant,
  MerchantCampaign,
  MerchantStatus,
  RewardClaimStatus,
  SocialPlatform,
  UpdateCampaignTemplateInput,
  UpdateMerchantCampaignInput,
  UpdateMerchantInput,
} from "@/domain/models/MerchantCampaign";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const dateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

function toMerchant(r: Row): Merchant {
  return {
    id: str(r.id),
    name: str(r.name),
    category: str(r.category),
    location: str(r.location),
    address: str(r.address),
    phone: str(r.phone),
    notes: str(r.notes),
    status: str(r.status) as MerchantStatus,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

function toTemplate(r: Row): CampaignTemplate {
  return {
    id: str(r.id),
    merchantId: str(r.merchant_id),
    name: str(r.name),
    motionTemplateId: str(r.motion_template_id),
    textStyleId: str(r.text_style_id),
    accentColor: str(r.accent_color),
    introKicker: str(r.intro_kicker),
    introTitle: str(r.intro_title),
    introSub: str(r.intro_sub),
    ctaTitle: str(r.cta_title),
    ctaPlace: str(r.cta_place),
    defaultStatement: str(r.default_statement),
    defaultMusicTrackId: str(r.default_music_track_id),
    captionLanguage: str(r.caption_language) === "en" ? "en" : "th",
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

function toCampaign(r: Row): MerchantCampaign {
  return {
    id: str(r.id),
    merchantId: str(r.merchant_id),
    templateId: str(r.template_id),
    slug: str(r.slug),
    qrKey: str(r.qr_key),
    title: str(r.title),
    discountPercent: Number(r.discount_percent),
    rewardDescription: str(r.reward_description),
    rewardCooldownDays: Number(r.reward_cooldown_days),
    status: str(r.status) as CampaignStatus,
    startsAt: dateOrNull(r.starts_at),
    endsAt: dateOrNull(r.ends_at),
    publishedAt: dateOrNull(r.published_at),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

function toCreator(r: Row): CampaignCreator {
  return {
    id: str(r.id),
    installHash: str(r.install_hash),
    platform: (r.platform as CampaignCreator["platform"]) ?? null,
    createdAt: new Date(r.created_at as string),
    lastSeenAt: new Date(r.last_seen_at as string),
  };
}

function toCreatorCampaign(r: Row): CreatorCampaign {
  return {
    id: str(r.id),
    creatorId: str(r.creator_id),
    campaignId: str(r.campaign_id),
    merchantId: str(r.merchant_id),
    referralCode: str(r.referral_code),
    videosMade: Number(r.videos_made ?? 0),
    lastVideoAt: dateOrNull(r.last_video_at),
    createdAt: new Date(r.created_at as string),
  };
}

function toClaim(r: Row): CreatorRewardClaim {
  return {
    id: str(r.id),
    creatorCampaignId: str(r.creator_campaign_id),
    creatorId: str(r.creator_id),
    campaignId: str(r.campaign_id),
    merchantId: str(r.merchant_id),
    installHash: str(r.install_hash),
    referralCode: str(r.referral_code),
    status: str(r.status) as RewardClaimStatus,
    claimedAt: new Date(r.claimed_at as string),
  };
}

function toPost(r: Row): CreatorSocialPost {
  return {
    id: str(r.id),
    creatorCampaignId: str(r.creator_campaign_id),
    creatorId: str(r.creator_id),
    campaignId: str(r.campaign_id),
    merchantId: str(r.merchant_id),
    socialPlatform: str(r.social_platform) as SocialPlatform,
    postUrl: str(r.post_url),
    referralCode: str(r.referral_code),
    createdAt: new Date(r.created_at as string),
  };
}

/**
 * Build `SET a = $2, b = $3, updated_at = NOW()` from a camelCase patch.
 * Only keys present in `columns` are written; undefined values are skipped.
 */
function updateSql(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  columns: Record<string, string>,
  touchUpdatedAt = true
): { text: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [id];
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return null;
  if (touchUpdatedAt) sets.push("updated_at = NOW()");
  return { text: `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, values };
}

const MERCHANT_COLUMNS = {
  name: "name",
  category: "category",
  location: "location",
  address: "address",
  phone: "phone",
  notes: "notes",
  status: "status",
};

const TEMPLATE_COLUMNS = {
  name: "name",
  motionTemplateId: "motion_template_id",
  textStyleId: "text_style_id",
  accentColor: "accent_color",
  introKicker: "intro_kicker",
  introTitle: "intro_title",
  introSub: "intro_sub",
  ctaTitle: "cta_title",
  ctaPlace: "cta_place",
  defaultStatement: "default_statement",
  defaultMusicTrackId: "default_music_track_id",
  captionLanguage: "caption_language",
};

const CAMPAIGN_COLUMNS = {
  templateId: "template_id",
  title: "title",
  discountPercent: "discount_percent",
  rewardDescription: "reward_description",
  rewardCooldownDays: "reward_cooldown_days",
  status: "status",
  startsAt: "starts_at",
  endsAt: "ends_at",
  qrKey: "qr_key",
  publishedAt: "published_at",
};

function isUniqueViolation(error: unknown, constraintHint?: string): boolean {
  const e = error as { code?: string; constraint?: string } | null;
  if (e?.code !== "23505") return false;
  return !constraintHint || (e.constraint ?? "").includes(constraintHint);
}

/** Requires migration 043. */
export class PostgresMerchantCampaignRepository implements IMerchantCampaignRepository {
  private readonly db = pool;

  async createMerchant(input: CreateMerchantInput): Promise<Merchant> {
    const { rows } = await this.db.query(
      `INSERT INTO merchants (id, name, category, location, address, phone, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [`mer_${randomUUID()}`, input.name, input.category, input.location, input.address, input.phone, input.notes, input.createdBy]
    );
    return toMerchant(rows[0]);
  }

  async updateMerchant(id: string, updates: UpdateMerchantInput): Promise<Merchant | null> {
    const sql = updateSql("merchants", id, updates, MERCHANT_COLUMNS);
    if (!sql) return this.findMerchant(id);
    const { rows } = await this.db.query(sql.text, sql.values);
    return rows[0] ? toMerchant(rows[0]) : null;
  }

  async findMerchant(id: string): Promise<Merchant | null> {
    const { rows } = await this.db.query(`SELECT * FROM merchants WHERE id = $1`, [id]);
    return rows[0] ? toMerchant(rows[0]) : null;
  }

  async listMerchants(): Promise<Merchant[]> {
    const { rows } = await this.db.query(`SELECT * FROM merchants ORDER BY created_at DESC`);
    return rows.map(toMerchant);
  }

  async createTemplate(input: CreateCampaignTemplateInput): Promise<CampaignTemplate> {
    const { rows } = await this.db.query(
      `INSERT INTO campaign_templates
         (id, merchant_id, name, motion_template_id, text_style_id, accent_color,
          intro_kicker, intro_title, intro_sub, cta_title, cta_place,
          default_statement, default_music_track_id, caption_language, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        `tpl_${randomUUID()}`,
        input.merchantId,
        input.name,
        input.motionTemplateId,
        input.textStyleId,
        input.accentColor,
        input.introKicker,
        input.introTitle,
        input.introSub,
        input.ctaTitle,
        input.ctaPlace,
        input.defaultStatement,
        input.defaultMusicTrackId,
        input.captionLanguage,
        input.createdBy,
      ]
    );
    return toTemplate(rows[0]);
  }

  async updateTemplate(id: string, updates: UpdateCampaignTemplateInput): Promise<CampaignTemplate | null> {
    const sql = updateSql("campaign_templates", id, updates, TEMPLATE_COLUMNS);
    if (!sql) return this.findTemplate(id);
    const { rows } = await this.db.query(sql.text, sql.values);
    return rows[0] ? toTemplate(rows[0]) : null;
  }

  async findTemplate(id: string): Promise<CampaignTemplate | null> {
    const { rows } = await this.db.query(`SELECT * FROM campaign_templates WHERE id = $1`, [id]);
    return rows[0] ? toTemplate(rows[0]) : null;
  }

  async listTemplates(merchantId?: string): Promise<CampaignTemplate[]> {
    const { rows } = merchantId
      ? await this.db.query(
          `SELECT * FROM campaign_templates WHERE merchant_id = $1 ORDER BY created_at DESC`,
          [merchantId]
        )
      : await this.db.query(`SELECT * FROM campaign_templates ORDER BY created_at DESC`);
    return rows.map(toTemplate);
  }

  async createCampaign(input: CreateMerchantCampaignInput): Promise<MerchantCampaign> {
    const { rows } = await this.db.query(
      `INSERT INTO merchant_campaigns
         (id, merchant_id, template_id, slug, qr_key, title, discount_percent,
          reward_description, reward_cooldown_days, starts_at, ends_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        `cmp_${randomUUID()}`,
        input.merchantId,
        input.templateId,
        input.slug,
        input.qrKey,
        input.title,
        input.discountPercent,
        input.rewardDescription,
        input.rewardCooldownDays,
        input.startsAt,
        input.endsAt,
        input.createdBy,
      ]
    );
    return toCampaign(rows[0]);
  }

  async updateCampaign(id: string, updates: UpdateMerchantCampaignInput): Promise<MerchantCampaign | null> {
    const sql = updateSql("merchant_campaigns", id, updates, CAMPAIGN_COLUMNS);
    if (!sql) return this.findCampaign(id);
    const { rows } = await this.db.query(sql.text, sql.values);
    return rows[0] ? toCampaign(rows[0]) : null;
  }

  async findCampaign(id: string): Promise<MerchantCampaign | null> {
    const { rows } = await this.db.query(`SELECT * FROM merchant_campaigns WHERE id = $1`, [id]);
    return rows[0] ? toCampaign(rows[0]) : null;
  }

  async findCampaignBySlug(slug: string): Promise<MerchantCampaign | null> {
    const { rows } = await this.db.query(`SELECT * FROM merchant_campaigns WHERE slug = $1`, [slug]);
    return rows[0] ? toCampaign(rows[0]) : null;
  }

  async listCampaigns(merchantId?: string): Promise<MerchantCampaign[]> {
    const { rows } = merchantId
      ? await this.db.query(
          `SELECT * FROM merchant_campaigns WHERE merchant_id = $1 ORDER BY created_at DESC`,
          [merchantId]
        )
      : await this.db.query(`SELECT * FROM merchant_campaigns ORDER BY created_at DESC`);
    return rows.map(toCampaign);
  }

  async campaignStats(campaignIds: string[]): Promise<CampaignStats[]> {
    if (campaignIds.length === 0) return [];
    const { rows } = await this.db.query(
      `SELECT c.id AS campaign_id,
              (SELECT COUNT(*) FROM creator_campaigns cc WHERE cc.campaign_id = c.id) AS creators,
              (SELECT COALESCE(SUM(videos_made), 0) FROM creator_campaigns cc WHERE cc.campaign_id = c.id) AS videos_made,
              (SELECT COUNT(*) FROM creator_reward_claims r WHERE r.campaign_id = c.id AND r.status = 'granted') AS granted,
              (SELECT COUNT(*) FROM creator_reward_claims r WHERE r.campaign_id = c.id AND r.status = 'rejected_limit') AS refused,
              (SELECT COUNT(*) FROM creator_social_posts p WHERE p.campaign_id = c.id) AS posts
         FROM merchant_campaigns c
        WHERE c.id = ANY($1::text[])`,
      [campaignIds]
    );
    return rows.map((r: Row) => ({
      campaignId: str(r.campaign_id),
      creators: Number(r.creators),
      videosMade: Number(r.videos_made),
      rewardsGranted: Number(r.granted),
      rewardsRefused: Number(r.refused),
      postLinks: Number(r.posts),
    }));
  }

  async upsertCreator(installHash: string, platform: CampaignCreator["platform"]): Promise<CampaignCreator> {
    const { rows } = await this.db.query(
      `INSERT INTO campaign_creators (id, install_hash, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (install_hash) DO UPDATE
         SET last_seen_at = NOW(),
             platform = COALESCE(EXCLUDED.platform, campaign_creators.platform)
       RETURNING *`,
      [`crt_${randomUUID()}`, installHash, platform]
    );
    return toCreator(rows[0]);
  }

  async findCreatorByInstallHash(installHash: string): Promise<CampaignCreator | null> {
    const { rows } = await this.db.query(`SELECT * FROM campaign_creators WHERE install_hash = $1`, [installHash]);
    return rows[0] ? toCreator(rows[0]) : null;
  }

  async findCreatorCampaign(creatorId: string, campaignId: string): Promise<CreatorCampaign | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM creator_campaigns WHERE creator_id = $1 AND campaign_id = $2`,
      [creatorId, campaignId]
    );
    return rows[0] ? toCreatorCampaign(rows[0]) : null;
  }

  async getOrCreateCreatorCampaign(input: {
    creatorId: string;
    campaignId: string;
    merchantId: string;
    nextCode: (attempt: number) => string;
  }): Promise<CreatorCampaign> {
    const existing = await this.findCreatorCampaign(input.creatorId, input.campaignId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const { rows } = await this.db.query(
          `INSERT INTO creator_campaigns (id, creator_id, campaign_id, merchant_id, referral_code)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (creator_id, campaign_id) DO NOTHING
           RETURNING *`,
          [`cc_${randomUUID()}`, input.creatorId, input.campaignId, input.merchantId, input.nextCode(attempt)]
        );
        if (rows[0]) return toCreatorCampaign(rows[0]);
        // A concurrent request from the same phone created it first.
        const raced = await this.findCreatorCampaign(input.creatorId, input.campaignId);
        if (raced) return raced;
      } catch (error) {
        // The code belongs to someone else: draw another.
        if (isUniqueViolation(error, "referral_code")) continue;
        throw error;
      }
    }
    throw new Error("Could not allocate a unique referral code");
  }

  async findCreatorCampaignByCode(code: string): Promise<CreatorCampaign | null> {
    const { rows } = await this.db.query(`SELECT * FROM creator_campaigns WHERE referral_code = $1`, [code]);
    return rows[0] ? toCreatorCampaign(rows[0]) : null;
  }

  async recordVideoMade(creatorCampaignId: string, at: Date): Promise<CreatorCampaign | null> {
    const { rows } = await this.db.query(
      `UPDATE creator_campaigns SET videos_made = videos_made + 1, last_video_at = $2
        WHERE id = $1 RETURNING *`,
      [creatorCampaignId, at]
    );
    return rows[0] ? toCreatorCampaign(rows[0]) : null;
  }

  async claimReward(input: {
    creatorCampaign: CreatorCampaign;
    installHash: string;
    cooldownDays: number;
    now: Date;
  }): Promise<{ claim: CreatorRewardClaim; lastGranted: CreatorRewardClaim | null }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      // Serialise claims for this device + campaign: two taps at once must not
      // both be granted.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `campaign-claim:${input.installHash}:${input.creatorCampaign.campaignId}`,
      ]);
      const last = await client.query(
        `SELECT * FROM creator_reward_claims
          WHERE install_hash = $1 AND campaign_id = $2 AND status = 'granted'
          ORDER BY claimed_at DESC LIMIT 1`,
        [input.installHash, input.creatorCampaign.campaignId]
      );
      const lastGranted = last.rows[0] ? toClaim(last.rows[0]) : null;
      const windowStart = input.now.getTime() - input.cooldownDays * 86_400_000;
      const blocked = lastGranted != null && lastGranted.claimedAt.getTime() > windowStart;
      const { rows } = await client.query(
        `INSERT INTO creator_reward_claims
           (id, creator_campaign_id, creator_id, campaign_id, merchant_id, install_hash,
            referral_code, status, claimed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          `rwc_${randomUUID()}`,
          input.creatorCampaign.id,
          input.creatorCampaign.creatorId,
          input.creatorCampaign.campaignId,
          input.creatorCampaign.merchantId,
          input.installHash,
          input.creatorCampaign.referralCode,
          blocked ? "rejected_limit" : "granted",
          input.now,
        ]
      );
      await client.query("COMMIT");
      return { claim: toClaim(rows[0]), lastGranted };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async lastGrantedClaim(installHash: string, campaignId: string): Promise<CreatorRewardClaim | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM creator_reward_claims
        WHERE install_hash = $1 AND campaign_id = $2 AND status = 'granted'
        ORDER BY claimed_at DESC LIMIT 1`,
      [installHash, campaignId]
    );
    return rows[0] ? toClaim(rows[0]) : null;
  }

  async addSocialPost(input: {
    creatorCampaign: CreatorCampaign;
    socialPlatform: SocialPlatform;
    postUrl: string;
  }): Promise<CreatorSocialPost> {
    const { rows } = await this.db.query(
      `INSERT INTO creator_social_posts
         (id, creator_campaign_id, creator_id, campaign_id, merchant_id, social_platform,
          post_url, referral_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (creator_campaign_id, post_url) DO UPDATE SET social_platform = EXCLUDED.social_platform
       RETURNING *`,
      [
        `post_${randomUUID()}`,
        input.creatorCampaign.id,
        input.creatorCampaign.creatorId,
        input.creatorCampaign.campaignId,
        input.creatorCampaign.merchantId,
        input.socialPlatform,
        input.postUrl,
        input.creatorCampaign.referralCode,
      ]
    );
    return toPost(rows[0]);
  }

  async listSocialPosts(creatorCampaignId: string): Promise<CreatorSocialPost[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM creator_social_posts WHERE creator_campaign_id = $1 ORDER BY created_at DESC`,
      [creatorCampaignId]
    );
    return rows.map(toPost);
  }
}

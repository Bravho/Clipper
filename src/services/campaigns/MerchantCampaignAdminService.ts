import { z } from "zod";
import type { IMerchantCampaignRepository } from "@/repositories/interfaces/IMerchantCampaignRepository";
import {
  CLIP_SOUND_CHOICE,
  type CampaignStats,
  type CampaignTemplate,
  type Merchant,
  type MerchantCampaign,
} from "@/domain/models/MerchantCampaign";
import { CAMPAIGN_LIMITS } from "@/config/merchantCampaigns";
import { MOTION_TEMPLATES } from "@/config/motionTemplates";
import { TEXT_GRAPHIC_STYLE_IDS } from "@/config/textGraphicStyles";
import { findMusicTrack } from "@/config/backgroundMusic";
import { MAX_STORY_FORMATS_PER_TEMPLATE, STORY_FORMAT_IDS } from "@/config/campaignStoryFormats";
import { TEXT_GRAPHIC_LIMITS } from "@/lib/textGraphics/plan";
import { generateCampaignSlug, generateQrKey } from "@/lib/campaigns/referralCode";
import { CampaignError } from "@/services/campaigns/CampaignErrors";
import { formatPercent } from "@/lib/campaigns/campaignManifest";
import {
  isUuid,
  itravyClient as defaultItravyClient,
  type ItravyClient,
} from "@/lib/campaigns/itravyClient";

/**
 * The operator side: shops, quick-video templates, campaigns and their QR.
 * Callers have already checked `isCampaignOperator` — this service trusts it.
 */

const text = (max: number) => z.string().trim().max(max).default("");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #D7262E");

export const merchantInputSchema = z.object({
  name: z.string().trim().min(1, "Shop name is required").max(80),
  category: text(TEXT_GRAPHIC_LIMITS.kicker),
  location: text(80),
  address: text(300),
  phone: text(40),
  notes: text(1000),
});

const motionTemplateIds = MOTION_TEMPLATES.map((t) => t.id) as [string, ...string[]];

/**
 * Operator texts may use {discount}, {code}, {merchant} and {location}; the
 * finished line is clipped to the text-graphics limits when the video is built.
 */
export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "Template name is required").max(80),
  motionTemplateId: z.enum(motionTemplateIds).default("none"),
  textStyleId: z.enum(TEXT_GRAPHIC_STYLE_IDS).default("premium"),
  accentColor: hex.default("#D7262E"),
  introKicker: text(60),
  introTitle: text(60),
  introSub: text(80),
  ctaTitle: text(60),
  ctaPlace: text(80),
  defaultStatement: text(CAMPAIGN_LIMITS.statementMaxChars * 3),
  defaultMusicTrackId: z
    .string()
    .default(CLIP_SOUND_CHOICE)
    .refine((id) => id === CLIP_SOUND_CHOICE || Boolean(findMusicTrack(id)), "Unknown music track"),
  captionLanguage: z.enum(["th", "en"]).default("th"),
  /** Story formats the customer can pick from: at most 4 (none = the original single clip). */
  storyFormats: z
    .array(z.enum(STORY_FORMAT_IDS))
    .max(MAX_STORY_FORMATS_PER_TEMPLATE, `Pick at most ${MAX_STORY_FORMATS_PER_TEMPLATE} video formats`)
    .refine((ids) => new Set(ids).size === ids.length, "Each video format only once")
    .default([]),
});

const optionalDate = z
  .union([z.string().datetime({ offset: true }), z.string().length(0), z.null()])
  .optional()
  .transform((v) => (v ? new Date(v) : null));

export const campaignInputSchema = z.object({
  merchantId: z.string().min(1),
  templateId: z.string().min(1),
  title: z.string().trim().min(1, "Campaign name is required").max(120),
  discountPercent: z.coerce.number().min(0).max(CAMPAIGN_LIMITS.maxDiscountPercent).default(5),
  rewardDescription: text(160),
  rewardCooldownDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(CAMPAIGN_LIMITS.maxRewardCooldownDays)
    .default(CAMPAIGN_LIMITS.defaultRewardCooldownDays),
  startsAt: optionalDate,
  endsAt: optionalDate,
  /** Require a verified creator phone before the video (default on). */
  requirePhoneOtp: z.boolean().optional(),
  /** iTravy campaign uuid ("" or null unlinks). */
  itravyCampaignId: z
    .union([z.string().trim(), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null))
    .refine((v) => v == null || isUuid(v), "Paste the iTravy campaign id (a uuid) from the iTravy admin page"),
});

export const campaignUpdateSchema = campaignInputSchema
  .omit({ merchantId: true })
  .partial()
  .extend({
    status: z.enum(["draft", "live", "paused", "ended"]).optional(),
    rotateQrKey: z.boolean().optional(),
  });

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new CampaignError(
      "invalid",
      first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input",
      400
    );
  }
  return result.data;
}

export interface CampaignAdminOverview {
  merchants: Merchant[];
  templates: CampaignTemplate[];
  campaigns: (MerchantCampaign & { qrLink: string; stats: CampaignStats })[];
}

export function campaignQrLink(campaign: Pick<MerchantCampaign, "slug" | "qrKey">, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/c/${campaign.slug}?k=${encodeURIComponent(campaign.qrKey)}`;
}

export class MerchantCampaignAdminService {
  constructor(
    private readonly repo: IMerchantCampaignRepository,
    private readonly itravy: ItravyClient = defaultItravyClient
  ) {}

  /**
   * A link to iTravy must point at a real iTravy campaign that gives friends
   * the SAME discount the video promises; otherwise a friend is shown 5% in the
   * video and something else at the counter.
   */
  private async checkItravyLink(itravyCampaignId: string, discountPercent: number): Promise<void> {
    const result = await this.itravy.getCampaign(itravyCampaignId);
    if (!result.ok || !result.data) {
      throw new CampaignError(
        "invalid",
        result.reason === "CAMPAIGN_NOT_FOUND"
          ? "iTravy has no campaign with that id."
          : `Could not check the iTravy campaign (${result.reason ?? "error"}). Try again.`,
        400
      );
    }
    const label = result.data.campaign.discount_label;
    const ours = `${formatPercent(discountPercent)}%`;
    if (label !== ours) {
      throw new CampaignError(
        "invalid",
        `The iTravy campaign gives ${label} but this campaign promises ${ours}. Make them the same.`,
        400
      );
    }
    if (result.data.campaign.status === "ended") {
      throw new CampaignError("invalid", "That iTravy campaign has ended.", 400);
    }
  }

  async overview(origin: string): Promise<CampaignAdminOverview> {
    const [merchants, templates, campaigns] = await Promise.all([
      this.repo.listMerchants(),
      this.repo.listTemplates(),
      this.repo.listCampaigns(),
    ]);
    const stats = await this.repo.campaignStats(campaigns.map((c) => c.id));
    const byId = new Map(stats.map((s) => [s.campaignId, s]));
    return {
      merchants,
      templates,
      campaigns: campaigns.map((c) => ({
        ...c,
        qrLink: campaignQrLink(c, origin),
        stats: byId.get(c.id) ?? {
          campaignId: c.id,
          creators: 0,
          videosMade: 0,
          rewardsGranted: 0,
          rewardsRefused: 0,
          postLinks: 0,
        },
      })),
    };
  }

  async createMerchant(input: unknown, operatorId: string): Promise<Merchant> {
    const data = parse(merchantInputSchema, input);
    return this.repo.createMerchant({ ...data, createdBy: operatorId });
  }

  async updateMerchant(id: string, input: unknown): Promise<Merchant> {
    const data = parse(
      merchantInputSchema.partial().extend({ status: z.enum(["active", "archived"]).optional() }),
      input
    );
    const updated = await this.repo.updateMerchant(id, definedOnly(data));
    if (!updated) throw new CampaignError("not_found", "Shop not found", 404);
    return updated;
  }

  async createTemplate(input: unknown, operatorId: string): Promise<CampaignTemplate> {
    const data = parse(templateInputSchema.extend({ merchantId: z.string().min(1) }), input);
    const merchant = await this.repo.findMerchant(data.merchantId);
    if (!merchant) throw new CampaignError("not_found", "Shop not found", 404);
    return this.repo.createTemplate({ ...data, createdBy: operatorId });
  }

  async updateTemplate(id: string, input: unknown): Promise<CampaignTemplate> {
    const data = parse(templateInputSchema.partial(), stripUndefined(input));
    const updated = await this.repo.updateTemplate(id, definedOnly(data));
    if (!updated) throw new CampaignError("not_found", "Template not found", 404);
    return updated;
  }

  async createCampaign(input: unknown, operatorId: string): Promise<MerchantCampaign> {
    const data = parse(campaignInputSchema, input);
    const template = await this.repo.findTemplate(data.templateId);
    if (!template || template.merchantId !== data.merchantId) {
      throw new CampaignError("invalid", "Pick a template that belongs to this shop", 400);
    }
    if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) {
      throw new CampaignError("invalid", "The end date must be after the start date", 400);
    }
    if (data.itravyCampaignId) await this.checkItravyLink(data.itravyCampaignId, data.discountPercent);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.repo.createCampaign({
          ...data,
          slug: generateCampaignSlug(),
          qrKey: generateQrKey(),
          createdBy: operatorId,
        });
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    throw new Error("unreachable");
  }

  /**
   * Edit a campaign. Going live for the first time stamps `publishedAt`.
   * `rotateQrKey` invalidates every printed QR (re-print required).
   */
  async updateCampaign(id: string, input: unknown): Promise<MerchantCampaign> {
    const current = await this.repo.findCampaign(id);
    if (!current) throw new CampaignError("not_found", "Campaign not found", 404);
    const data = parse(campaignUpdateSchema, stripUndefined(input));
    if (data.templateId && data.templateId !== current.templateId) {
      const template = await this.repo.findTemplate(data.templateId);
      if (!template || template.merchantId !== current.merchantId) {
        throw new CampaignError("invalid", "Pick a template that belongs to this shop", 400);
      }
    }
    const { rotateQrKey, ...rest } = data;
    const startsAt = rest.startsAt === undefined ? current.startsAt : rest.startsAt;
    const endsAt = rest.endsAt === undefined ? current.endsAt : rest.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new CampaignError("invalid", "The end date must be after the start date", 400);
    }
    const linkTo = rest.itravyCampaignId === undefined ? current.itravyCampaignId : rest.itravyCampaignId;
    const discount = rest.discountPercent ?? current.discountPercent;
    if (
      linkTo &&
      (linkTo !== current.itravyCampaignId || discount !== current.discountPercent)
    ) {
      await this.checkItravyLink(linkTo, discount);
    }
    // A date the PATCH did not mention parses to null; keep the stored one.
    const raw = input_(input);
    if (!("startsAt" in raw)) delete (rest as Record<string, unknown>).startsAt;
    if (!("endsAt" in raw)) delete (rest as Record<string, unknown>).endsAt;
    const updated = await this.repo.updateCampaign(id, definedOnly({
      ...rest,
      ...(rotateQrKey ? { qrKey: generateQrKey() } : {}),
      ...(rest.status === "live" && !current.publishedAt ? { publishedAt: new Date() } : {}),
    }));
    if (!updated) throw new CampaignError("not_found", "Campaign not found", 404);
    return updated;
  }
}

function input_(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function definedOnly<T extends object>(patch: T): T {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as T;
}

function stripUndefined(input: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input_(input)).filter(([, v]) => v !== undefined));
}

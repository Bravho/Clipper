/**
 * Merchant Referral Campaigns (Oct 2026).
 *
 * A shop prints a campaign QR. A customer scans it inside the RClipper app,
 * shoots one short clip, and the phone renders a branded video that ends with
 * "Friends get 5% off — Code A7K2". The customer posts it themselves. Staff
 * give a small gift after looking at the post; friends later redeem the code
 * in iTravy, which reads it through `/api/travy/referral-codes/:code`.
 *
 * No login: a creator is an anonymous phone installation, known to the server
 * only by a peppered hash of a random install id (`installHash.ts`). No video
 * ever reaches the server — it renders and stays on the phone.
 *
 * Tables: migration 043_merchant_campaigns.sql.
 */

export type MerchantStatus = "active" | "archived";

export interface Merchant {
  id: string;
  name: string;
  /** Short kind of shop, shown as the small chip on the opening card ("CAFÉ"). */
  category: string;
  /** Area / branch, e.g. "Nimman, Chiang Mai". Shown under the name. */
  location: string;
  address: string;
  phone: string;
  notes: string;
  status: MerchantStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateMerchantInput = Pick<
  Merchant,
  "name" | "category" | "location" | "address" | "phone" | "notes" | "createdBy"
>;
export type UpdateMerchantInput = Partial<
  Pick<Merchant, "name" | "category" | "location" | "address" | "phone" | "notes" | "status">
>;

/**
 * Special "music" choice: keep the sound the customer recorded instead of a
 * catalogue track. Every other value is a `backgroundMusic.ts` id (or "none",
 * which the builder treats as clip sound too — a video needs SOME audio track).
 */
export const CLIP_SOUND_CHOICE = "clip_sound";

export interface CampaignTemplate {
  id: string;
  merchantId: string;
  /** Operator's own label, e.g. "Rainy season — warm look". */
  name: string;
  /** `config/motionTemplates.ts` id (frame + decoration). */
  motionTemplateId: string;
  /** `config/textGraphicStyles.ts` pack for the opening and closing cards. */
  textStyleId: string;
  /** #RRGGBB, the brand colour. */
  accentColor: string;
  /** Opening card: small chip (defaults to the merchant category). */
  introKicker: string;
  /** Opening card: main line (defaults to the merchant name). */
  introTitle: string;
  /** Opening card: second line (defaults to the merchant location). */
  introSub: string;
  /**
   * Closing card main line. `{discount}` and `{code}` are filled in per
   * creator, e.g. "เพื่อนรับส่วนลด {discount}%".
   */
  ctaTitle: string;
  /** Closing card bottom line, `{code}` filled in: "ใช้โค้ด {code}". */
  ctaPlace: string;
  /** Pre-filled customer sentence; factual, never a forced review. */
  defaultStatement: string;
  /** Pre-selected sound: a catalogue track id or {@link CLIP_SOUND_CHOICE}. */
  defaultMusicTrackId: string;
  /** Which caption slot the customer's sentence is drawn in. */
  captionLanguage: "th" | "en";
  /**
   * Story formats the customer can choose from (max 4, ids from
   * `config/campaignStoryFormats.ts`). Empty = the original single-clip video.
   */
  storyFormats: string[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateCampaignTemplateInput = Omit<
  CampaignTemplate,
  "id" | "createdAt" | "updatedAt" | "storyFormats"
> & { storyFormats?: string[] };
export type UpdateCampaignTemplateInput = Partial<
  Omit<CampaignTemplate, "id" | "merchantId" | "createdBy" | "createdAt" | "updatedAt">
>;

export type CampaignStatus = "draft" | "live" | "paused" | "ended";

export interface MerchantCampaign {
  id: string;
  merchantId: string;
  templateId: string;
  /** Public id in the QR link: /c/<slug>. Random, not guessable from the shop name. */
  slug: string;
  /** Secret printed in the QR (`?k=`). Without it the customer page will not open. */
  qrKey: string;
  title: string;
  /** What a friend gets, e.g. 5 (= 5% off). */
  discountPercent: number;
  /** What the creator gets from staff, e.g. "Free iced tea". */
  rewardDescription: string;
  /** One creator reward per device per campaign per this many days. */
  rewardCooldownDays: number;
  status: CampaignStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  /** First time the campaign went live; codes issued from then are published. */
  publishedAt: Date | null;
  /**
   * The creator must verify a phone by SMS code before the quick video is
   * made (default). iTravy uses it to refuse a creator's own code.
   */
  requirePhoneOtp: boolean;
  /**
   * The iTravy referral campaign (uuid, from the iTravy admin page) where
   * friends redeem this campaign's codes. Null = not linked yet: codes are
   * issued but iTravy cannot redeem them.
   */
  itravyCampaignId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateMerchantCampaignInput = Pick<
  MerchantCampaign,
  | "merchantId"
  | "templateId"
  | "title"
  | "discountPercent"
  | "rewardDescription"
  | "rewardCooldownDays"
  | "startsAt"
  | "endsAt"
  | "createdBy"
> & { slug: string; qrKey: string; requirePhoneOtp?: boolean; itravyCampaignId?: string | null };

export type UpdateMerchantCampaignInput = Partial<
  Pick<
    MerchantCampaign,
    | "templateId"
    | "title"
    | "discountPercent"
    | "rewardDescription"
    | "rewardCooldownDays"
    | "status"
    | "startsAt"
    | "endsAt"
    | "qrKey"
    | "publishedAt"
    | "requirePhoneOtp"
    | "itravyCampaignId"
  >
>;

/** One anonymous phone installation. */
export interface CampaignCreator {
  id: string;
  /** sha256(pepper + install id) — the raw id never reaches the database. */
  installHash: string;
  platform: "ios" | "android" | "web" | null;
  /** HMAC(pepper, E.164 number) of the SMS-verified phone; null until verified. */
  phoneHash: string | null;
  /** Last four digits, for support only. */
  phoneLast4: string | null;
  phoneVerifiedAt: Date | null;
  /** When iTravy last accepted this phone for the creator (iTravy keeps it per creator). */
  itravyPhoneSyncedAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
}

/** One SMS code sent to a phone (stored hashed). */
export interface CampaignPhoneOtp {
  id: string;
  installHash: string;
  phoneHash: string;
  phoneLast4: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
}

/** A creator taking part in one campaign; owns the immutable referral code. */
export interface CreatorCampaign {
  id: string;
  creatorId: string;
  campaignId: string;
  merchantId: string;
  referralCode: string;
  videosMade: number;
  lastVideoAt: Date | null;
  /** iTravy accepted this code (it can be redeemed there). */
  itravyRegisteredAt: Date | null;
  /** Last refusal from iTravy, for the operator page. */
  itravyError: string | null;
  createdAt: Date;
}

export type RewardClaimStatus = "granted" | "rejected_limit";

export interface CreatorRewardClaim {
  id: string;
  creatorCampaignId: string;
  creatorId: string;
  campaignId: string;
  merchantId: string;
  installHash: string;
  /** The creator's verified phone at claim time, if any. */
  phoneHash: string | null;
  referralCode: string;
  status: RewardClaimStatus;
  claimedAt: Date;
}

export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "other";

export interface CreatorSocialPost {
  id: string;
  creatorCampaignId: string;
  creatorId: string;
  campaignId: string;
  merchantId: string;
  socialPlatform: SocialPlatform;
  postUrl: string;
  referralCode: string;
  createdAt: Date;
}

/** Per-campaign numbers for the operator page. */
export interface CampaignStats {
  campaignId: string;
  creators: number;
  videosMade: number;
  rewardsGranted: number;
  rewardsRefused: number;
  postLinks: number;
}

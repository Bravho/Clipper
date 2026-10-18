import { merchantCampaignRepository } from "@/repositories";
import { CampaignCreatorService } from "@/services/campaigns/CampaignCreatorService";
import { MerchantCampaignAdminService } from "@/services/campaigns/MerchantCampaignAdminService";

/** Merchant Referral Campaigns (migration 043). */
export const campaignCreatorService = new CampaignCreatorService(merchantCampaignRepository);
export const merchantCampaignAdminService = new MerchantCampaignAdminService(merchantCampaignRepository);
export { CampaignError } from "@/services/campaigns/CampaignErrors";

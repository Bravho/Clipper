/**
 * Orchestrates TikTok Ads drafts + reporting/import for Ad Lab.
 * Never enables paid delivery or charges the owner.
 */

import type { AdLabAdTargeting, AdLabAdsLink } from "@/domain/models/AdLabAdTargeting";
import type { AdLabPublication } from "@/domain/models/AdLabPublication";
import type { IAdLabPublicationRepository } from "@/repositories/interfaces/IAdLabPublicationRepository";
import { adLabPublicationRepository } from "@/repositories";
import {
  createPausedSparkAdDraft,
  fetchAdReport,
} from "@/services/ad-lab/tiktokMarketingClient";
import {
  parseAdsManagerCsv,
  type AdLabAdsImportRow,
} from "@/services/ad-lab/adLabCsvImport";
import { pool } from "@/lib/db";

export class AdLabAdsError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "forbidden" | "not_tiktok" | "invalid_csv" | "provider_error"
  ) {
    super(message);
    this.name = "AdLabAdsError";
  }
}

export class AdLabAdsService {
  constructor(private publications: IAdLabPublicationRepository = adLabPublicationRepository) {}

  async createDraftForTarget(
    ownerId: string,
    targetId: string,
    targeting: AdLabAdTargeting,
    opts?: { dailyBudgetBaht?: number; campaignName?: string }
  ): Promise<{ publication: AdLabPublication; link: AdLabAdsLink }> {
    const found = await this.publications.findTargetById(targetId);
    if (!found) throw new AdLabAdsError("Target not found.", "not_found");
    if (found.ownerId !== ownerId) throw new AdLabAdsError("Target not found.", "not_found");
    if (found.target.channel !== "tiktok") {
      throw new AdLabAdsError("Ads Manager draft is only wired for TikTok in this phase.", "not_tiktok");
    }

    const publication = await this.publications.findById(found.target.publicationId);
    if (!publication) throw new AdLabAdsError("Publication not found.", "not_found");

    const draft = await createPausedSparkAdDraft({
      targeting,
      campaignName: opts?.campaignName || publication.campaignName,
      dailyBudgetBaht: opts?.dailyBudgetBaht ?? Math.max(0, found.target.plannedBudget / 7),
      platformPostId: found.target.platformPostId,
    });

    const link: AdLabAdsLink = {
      advertiserId: draft.advertiserId,
      campaignId: draft.campaignId,
      adgroupId: draft.adgroupId,
      adId: draft.adId,
      sparkCode: draft.sparkCode,
      status: draft.status === "stubbed" ? "stubbed" : "paused",
      targeting: {
        ...targeting,
        advertiserId: draft.advertiserId,
        sparkPostId: targeting.sparkPostId || found.target.platformPostId || "",
      },
      lastSyncedAt: null,
      lastError: null,
      stub: draft.stub,
    };

    await this.publications.updateTargetAdsLink(targetId, link);
    const next = await this.publications.findById(publication.id);
    if (!next) throw new AdLabAdsError("Publication not found after save.", "not_found");
    return { publication: next, link };
  }

  async syncReport(ownerId: string, targetId: string): Promise<AdLabPublication> {
    const found = await this.publications.findTargetById(targetId);
    if (!found) throw new AdLabAdsError("Target not found.", "not_found");
    if (found.ownerId !== ownerId) throw new AdLabAdsError("Target not found.", "not_found");

    const ads = found.target.ads;
    if (!ads?.adId) throw new AdLabAdsError("No Ads Manager ad linked on this target yet.", "not_found");

    const report = await fetchAdReport(ads.adId, ads.advertiserId);
    await this.publications.updateTargetEconomics(targetId, {
      spend: report.spend,
      conversions: report.conversions || undefined,
    });
    await this.publications.updateTargetAdsLink(targetId, {
      ...ads,
      lastSyncedAt: new Date().toISOString(),
      lastError: report.stub ? "stub_report" : null,
    });
    if (this.publications.updateTargetAdsMetrics) {
      await this.publications.updateTargetAdsMetrics(targetId, {
        spend: report.spend,
        impressions: report.impressions,
        clicks: report.clicks,
        conversions: report.conversions,
        videoViews: report.videoViews,
        stub: report.stub,
      });
    }

    const publication = await this.publications.findById(found.target.publicationId);
    if (!publication) throw new AdLabAdsError("Publication not found.", "not_found");
    return publication;
  }

  async importCsv(
    ownerId: string,
    brandId: string,
    csvText: string,
    targetId?: string | null
  ): Promise<{ rows: AdLabAdsImportRow[]; appliedToTarget: boolean; publication: AdLabPublication | null }> {
    let rows: AdLabAdsImportRow[];
    try {
      rows = parseAdsManagerCsv(csvText);
    } catch (err) {
      throw new AdLabAdsError(err instanceof Error ? err.message : "Invalid CSV.", "invalid_csv");
    }
    if (rows.length === 0) {
      throw new AdLabAdsError("No data rows found in CSV.", "invalid_csv");
    }

    try {
      for (const row of rows) {
        await pool.query(
          "INSERT INTO ad_lab_ads_imports\n"
          + "  (owner_id, brand_id, target_id, campaign_name, ad_id, spend, impressions, clicks, conversions, revenue, raw_row)\n"
          + " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)",
          [
            ownerId,
            brandId,
            targetId ?? null,
            row.campaignName || null,
            row.adId || null,
            row.spend,
            row.impressions,
            row.clicks,
            row.conversions,
            row.revenue,
            JSON.stringify(row.raw),
          ]
        );
      }
    } catch (err) {
      console.warn("[AdLabAdsService.importCsv] ads_imports table unavailable — apply migration 040:", err);
    }

    let publication: AdLabPublication | null = null;
    let appliedToTarget = false;
    if (targetId) {
      const found = await this.publications.findTargetById(targetId);
      if (!found || found.ownerId !== ownerId) {
        throw new AdLabAdsError("Target not found.", "not_found");
      }
      const totals = rows.reduce(
        (acc, r) => ({
          spend: acc.spend + r.spend,
          revenue: acc.revenue + r.revenue,
          conversions: acc.conversions + (r.conversions ?? 0),
        }),
        { spend: 0, revenue: 0, conversions: 0 }
      );
      await this.publications.updateTargetEconomics(targetId, totals);
      if (rows[0]?.adId) {
        const existing = found.target.ads;
        await this.publications.updateTargetAdsLink(targetId, {
          advertiserId: existing?.advertiserId || "",
          campaignId: existing?.campaignId ?? null,
          adgroupId: existing?.adgroupId ?? null,
          adId: rows[0].adId,
          sparkCode: existing?.sparkCode ?? null,
          status: existing?.status || "draft",
          targeting: existing?.targeting ?? null,
          lastSyncedAt: new Date().toISOString(),
          lastError: null,
          stub: existing?.stub ?? true,
        });
      }
      publication = await this.publications.findById(found.target.publicationId);
      appliedToTarget = true;
    }

    return { rows, appliedToTarget, publication };
  }
}

export const adLabAdsService = new AdLabAdsService();

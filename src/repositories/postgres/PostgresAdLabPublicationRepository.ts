import { pool } from "@/lib/db";
import type { Pool, PoolClient } from "pg";
import type { AdLabChannel } from "@/domain/models/AdLab";
import type { AdLabAdsLink } from "@/domain/models/AdLabAdTargeting";
import type {
  AdLabNormalizedMetrics,
  AdLabPublication,
  AdLabPublicationStatus,
  AdLabPublicationTarget,
  AdLabTargetStatus,
} from "@/domain/models/AdLabPublication";
import type {
  CreateAdLabPublicationInput,
  IAdLabPublicationRepository,
  UpdateAdLabTargetOutcome,
} from "@/repositories/interfaces/IAdLabPublicationRepository";

/** Tables from migration 039 + ads columns from 040_ad_lab_ads_outcomes.sql. */

interface PublicationRow {
  id: string;
  owner_id: string;
  brand_id: string;
  draft_id: string;
  plan_id: string | null;
  campaign_name: string;
  caption: string;
  video_key: string;
  video_name: string;
  provider_post_id: string | null;
  status: AdLabPublicationStatus;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface TargetRow {
  id: string;
  publication_id: string;
  channel: AdLabChannel;
  connection_id: string;
  provider_account_id: string;
  platform: string;
  account_label: string;
  status: AdLabTargetStatus;
  platform_post_id: string | null;
  platform_url: string | null;
  error: string | null;
  published_at: Date | null;
  planned_budget: string | number;
  spend: string | number;
  revenue: string | number;
  conversions: number;
  metrics: AdLabNormalizedMetrics | null;
  metrics_fetched_at: Date | null;
  ads_advertiser_id?: string | null;
  ads_campaign_id?: string | null;
  ads_adgroup_id?: string | null;
  ads_ad_id?: string | null;
  ads_spark_code?: string | null;
  ads_status?: string | null;
  ads_targeting?: AdLabAdsLink["targeting"] | null;
  ads_stub?: boolean | null;
  ads_last_synced_at?: Date | null;
  ads_last_error?: string | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function toAds(row: TargetRow): AdLabAdsLink | null {
  if (!(row.ads_ad_id || row.ads_campaign_id || row.ads_status)) return null;
  return {
    advertiserId: row.ads_advertiser_id || "",
    campaignId: row.ads_campaign_id ?? null,
    adgroupId: row.ads_adgroup_id ?? null,
    adId: row.ads_ad_id ?? null,
    sparkCode: row.ads_spark_code ?? null,
    status: (row.ads_status as AdLabAdsLink["status"]) || "none",
    targeting: row.ads_targeting ?? null,
    lastSyncedAt: iso(row.ads_last_synced_at ?? null),
    lastError: row.ads_last_error ?? null,
    stub: Boolean(row.ads_stub),
  };
}

function toTarget(row: TargetRow): AdLabPublicationTarget {
  return {
    id: row.id,
    publicationId: row.publication_id,
    channel: row.channel,
    connectionId: row.connection_id,
    providerAccountId: row.provider_account_id,
    platform: row.platform,
    accountLabel: row.account_label,
    status: row.status,
    platformPostId: row.platform_post_id,
    platformUrl: row.platform_url,
    error: row.error,
    publishedAt: iso(row.published_at),
    plannedBudget: Number(row.planned_budget) || 0,
    spend: Number(row.spend) || 0,
    revenue: Number(row.revenue) || 0,
    conversions: Number(row.conversions) || 0,
    metrics: row.metrics,
    metricsFetchedAt: iso(row.metrics_fetched_at),
    ads: toAds(row),
  };
}

function toPublication(row: PublicationRow, targets: AdLabPublicationTarget[]): AdLabPublication {
  return {
    id: row.id,
    ownerId: row.owner_id,
    brandId: row.brand_id,
    draftId: row.draft_id,
    planId: row.plan_id,
    campaignName: row.campaign_name,
    caption: row.caption,
    videoKey: row.video_key,
    videoName: row.video_name,
    providerPostId: row.provider_post_id,
    status: row.status,
    error: row.error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    targets,
  };
}

/** Base columns always present (migration 039). */
const TARGET_COLUMNS_BASE = `id, publication_id, channel, connection_id, provider_account_id, platform,
  account_label, status, platform_post_id, platform_url, error, published_at, planned_budget,
  spend, revenue, conversions, metrics, metrics_fetched_at`;

/** Extended columns from migration 040 — selected when available. */
const TARGET_COLUMNS_ADS = `, ads_advertiser_id, ads_campaign_id, ads_adgroup_id, ads_ad_id, ads_spark_code, ads_status,
  ads_targeting, ads_stub, ads_last_synced_at, ads_last_error`;

export class PostgresAdLabPublicationRepository implements IAdLabPublicationRepository {
  constructor(private db: Pool = pool) {}

  private adsColumnsReady: boolean | null = null;

  private async targetColumns(): Promise<string> {
    if (this.adsColumnsReady === null) {
      try {
        const { rows } = await this.db.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_name = 'ad_lab_publication_targets' AND column_name = 'ads_ad_id'
           ) AS exists`
        );
        this.adsColumnsReady = Boolean(rows[0]?.exists);
      } catch {
        this.adsColumnsReady = false;
      }
    }
    return this.adsColumnsReady ? TARGET_COLUMNS_BASE + TARGET_COLUMNS_ADS : TARGET_COLUMNS_BASE;
  }

  async create(input: CreateAdLabPublicationInput): Promise<AdLabPublication> {
    const cols = await this.targetColumns();
    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<PublicationRow>(
        `INSERT INTO ad_lab_publications
           (owner_id, brand_id, draft_id, plan_id, campaign_name, caption, video_key, video_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          input.ownerId, input.brandId, input.draftId, input.planId,
          input.campaignName, input.caption, input.videoKey, input.videoName,
        ]
      );
      const publication = rows[0];
      const targets: AdLabPublicationTarget[] = [];
      for (const t of input.targets) {
        const result = await client.query<TargetRow>(
          `INSERT INTO ad_lab_publication_targets
             (publication_id, channel, connection_id, provider_account_id, platform, account_label, planned_budget)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING ${cols}`,
          [publication.id, t.channel, t.connectionId, t.providerAccountId, t.platform, t.accountLabel, t.plannedBudget]
        );
        targets.push(toTarget(result.rows[0]));
      }
      await client.query("COMMIT");
      return toPublication(publication, targets);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async targetsFor(publicationIds: string[]): Promise<Map<string, AdLabPublicationTarget[]>> {
    const map = new Map<string, AdLabPublicationTarget[]>();
    if (publicationIds.length === 0) return map;
    const cols = await this.targetColumns();
    const { rows } = await this.db.query<TargetRow>(
      `SELECT ${cols} FROM ad_lab_publication_targets
        WHERE publication_id = ANY($1::uuid[])
        ORDER BY created_at ASC`,
      [publicationIds]
    );
    for (const row of rows) {
      const list = map.get(row.publication_id) ?? [];
      list.push(toTarget(row));
      map.set(row.publication_id, list);
    }
    return map;
  }

  async findById(id: string): Promise<AdLabPublication | null> {
    const { rows } = await this.db.query<PublicationRow>(
      "SELECT * FROM ad_lab_publications WHERE id = $1",
      [id]
    );
    if (!rows[0]) return null;
    const targets = await this.targetsFor([id]);
    return toPublication(rows[0], targets.get(id) ?? []);
  }

  async listByOwner(ownerId: string, limit = 100): Promise<AdLabPublication[]> {
    const { rows } = await this.db.query<PublicationRow>(
      `SELECT * FROM ad_lab_publications WHERE owner_id = $1
        ORDER BY created_at DESC LIMIT $2`,
      [ownerId, limit]
    );
    const targets = await this.targetsFor(rows.map((r) => r.id));
    return rows.map((r) => toPublication(r, targets.get(r.id) ?? []));
  }

  async findTargetById(targetId: string) {
    const cols = await this.targetColumns();
    const selectList = cols
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => `t.${c}`)
      .join(", ");
    const { rows } = await this.db.query<TargetRow & { owner_id: string }>(
      `SELECT ${selectList}, p.owner_id
         FROM ad_lab_publication_targets t
         JOIN ad_lab_publications p ON p.id = t.publication_id
        WHERE t.id = $1`,
      [targetId]
    );
    if (!rows[0]) return null;
    return { ownerId: rows[0].owner_id, target: toTarget(rows[0]) };
  }

  async setProviderPost(
    id: string,
    providerPostId: string | null,
    status: AdLabPublicationStatus,
    error: string | null = null
  ): Promise<void> {
    await this.db.query(
      `UPDATE ad_lab_publications
          SET provider_post_id = $2, status = $3, error = $4, updated_at = NOW()
        WHERE id = $1`,
      [id, providerPostId, status, error]
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM ad_lab_publications WHERE id = $1", [id]);
  }

  async setStatus(id: string, status: AdLabPublicationStatus, error: string | null = null): Promise<void> {
    await this.db.query(
      "UPDATE ad_lab_publications SET status = $2, error = $3, updated_at = NOW() WHERE id = $1",
      [id, status, error]
    );
  }

  async updateTargetOutcome(targetId: string, outcome: UpdateAdLabTargetOutcome): Promise<void> {
    await this.db.query(
      `UPDATE ad_lab_publication_targets
          SET status = $2,
              platform_post_id = COALESCE($3, platform_post_id),
              platform_url = COALESCE($4, platform_url),
              error = $5,
              published_at = COALESCE($6, published_at),
              updated_at = NOW()
        WHERE id = $1`,
      [
        targetId,
        outcome.status,
        outcome.platformPostId ?? null,
        outcome.platformUrl ?? null,
        outcome.error ?? null,
        outcome.publishedAt ?? null,
      ]
    );
  }

  async updateTargetMetrics(
    targetId: string,
    metrics: AdLabNormalizedMetrics,
    raw: Record<string, unknown> | null
  ): Promise<void> {
    await this.db.query(
      `UPDATE ad_lab_publication_targets
          SET metrics = $2::jsonb, metrics_raw = $3::jsonb, metrics_fetched_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [targetId, JSON.stringify(metrics), raw ? JSON.stringify(raw) : null]
    );
    await this.db.query(
      "INSERT INTO ad_lab_metric_snapshots (target_id, metrics) VALUES ($1, $2::jsonb)",
      [targetId, JSON.stringify(metrics)]
    );
  }

  async updateTargetEconomics(
    targetId: string,
    values: { spend?: number; revenue?: number; conversions?: number }
  ): Promise<void> {
    await this.db.query(
      `UPDATE ad_lab_publication_targets
          SET spend = COALESCE($2, spend),
              revenue = COALESCE($3, revenue),
              conversions = COALESCE($4, conversions),
              updated_at = NOW()
        WHERE id = $1`,
      [targetId, values.spend ?? null, values.revenue ?? null, values.conversions ?? null]
    );
  }

  async updateTargetAdsLink(targetId: string, link: AdLabAdsLink): Promise<void> {
    const cols = await this.targetColumns();
    if (!cols.includes("ads_ad_id")) {
      throw new Error(
        "Ads columns missing — apply migration 040_ad_lab_ads_outcomes.sql before linking Ads Manager drafts."
      );
    }
    await this.db.query(
      `UPDATE ad_lab_publication_targets
          SET ads_advertiser_id = $2,
              ads_campaign_id = $3,
              ads_adgroup_id = $4,
              ads_ad_id = $5,
              ads_spark_code = $6,
              ads_status = $7,
              ads_targeting = $8::jsonb,
              ads_stub = $9,
              ads_last_synced_at = $10,
              ads_last_error = $11,
              updated_at = NOW()
        WHERE id = $1`,
      [
        targetId,
        link.advertiserId || null,
        link.campaignId,
        link.adgroupId,
        link.adId,
        link.sparkCode,
        link.status,
        link.targeting ? JSON.stringify(link.targeting) : null,
        link.stub,
        link.lastSyncedAt,
        link.lastError,
      ]
    );
  }

  async updateTargetAdsMetrics(targetId: string, metrics: Record<string, unknown>): Promise<void> {
    const cols = await this.targetColumns();
    if (!cols.includes("ads_ad_id")) return;
    await this.db.query(
      `UPDATE ad_lab_publication_targets
          SET ads_metrics = $2::jsonb, ads_last_synced_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [targetId, JSON.stringify(metrics)]
    );
  }
}

import { randomUUID } from "crypto";
import type { AdLabAdsLink } from "@/domain/models/AdLabAdTargeting";
import type {
  AdLabNormalizedMetrics,
  AdLabPublication,
  AdLabPublicationStatus,
} from "@/domain/models/AdLabPublication";
import type {
  CreateAdLabPublicationInput,
  IAdLabPublicationRepository,
  UpdateAdLabTargetOutcome,
} from "@/repositories/interfaces/IAdLabPublicationRepository";

/** In-memory repository for tests (pass a fresh Map per test). */
export class MockAdLabPublicationRepository implements IAdLabPublicationRepository {
  readonly snapshots: Array<{ targetId: string; metrics: AdLabNormalizedMetrics }> = [];

  constructor(private store: Map<string, AdLabPublication> = new Map()) {}

  async create(input: CreateAdLabPublicationInput): Promise<AdLabPublication> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const publication: AdLabPublication = {
      id,
      ownerId: input.ownerId,
      brandId: input.brandId,
      draftId: input.draftId,
      planId: input.planId,
      campaignName: input.campaignName,
      caption: input.caption,
      videoKey: input.videoKey,
      videoName: input.videoName,
      providerPostId: null,
      status: "sending",
      error: null,
      createdAt: now,
      updatedAt: now,
      targets: input.targets.map((t) => ({
        id: randomUUID(),
        publicationId: id,
        channel: t.channel,
        connectionId: t.connectionId,
        providerAccountId: t.providerAccountId,
        platform: t.platform,
        accountLabel: t.accountLabel,
        status: "pending",
        platformPostId: null,
        platformUrl: null,
        error: null,
        publishedAt: null,
        plannedBudget: t.plannedBudget,
        spend: 0,
        revenue: 0,
        conversions: 0,
        metrics: null,
        metricsFetchedAt: null,
        ads: null,
      })),
    };
    this.store.set(id, publication);
    return structuredClone(publication);
  }

  async findById(id: string) {
    const found = this.store.get(id);
    return found ? structuredClone(found) : null;
  }

  async listByOwner(ownerId: string, limit = 100) {
    return [...this.store.values()]
      .filter((p) => p.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }

  private locate(targetId: string) {
    for (const publication of this.store.values()) {
      const target = publication.targets.find((t) => t.id === targetId);
      if (target) return { publication, target };
    }
    return null;
  }

  async findTargetById(targetId: string) {
    const found = this.locate(targetId);
    return found ? { ownerId: found.publication.ownerId, target: structuredClone(found.target) } : null;
  }

  async setProviderPost(id: string, providerPostId: string | null, status: AdLabPublicationStatus, error: string | null = null) {
    const p = this.store.get(id);
    if (p) Object.assign(p, { providerPostId, status, error, updatedAt: new Date().toISOString() });
  }

  async delete(id: string) {
    this.store.delete(id);
  }

  async setStatus(id: string, status: AdLabPublicationStatus, error: string | null = null) {
    const p = this.store.get(id);
    if (p) Object.assign(p, { status, error, updatedAt: new Date().toISOString() });
  }

  async updateTargetOutcome(targetId: string, outcome: UpdateAdLabTargetOutcome) {
    const found = this.locate(targetId);
    if (!found) return;
    const t = found.target;
    t.status = outcome.status;
    t.platformPostId = outcome.platformPostId ?? t.platformPostId;
    t.platformUrl = outcome.platformUrl ?? t.platformUrl;
    t.error = outcome.error ?? null;
    t.publishedAt = outcome.publishedAt ? outcome.publishedAt.toISOString() : t.publishedAt;
  }

  async updateTargetMetrics(targetId: string, metrics: AdLabNormalizedMetrics) {
    const found = this.locate(targetId);
    if (!found) return;
    found.target.metrics = metrics;
    found.target.metricsFetchedAt = new Date().toISOString();
    this.snapshots.push({ targetId, metrics });
  }

  async updateTargetEconomics(targetId: string, values: { spend?: number; revenue?: number; conversions?: number }) {
    const found = this.locate(targetId);
    if (!found) return;
    if (values.spend !== undefined) found.target.spend = values.spend;
    if (values.revenue !== undefined) found.target.revenue = values.revenue;
    if (values.conversions !== undefined) found.target.conversions = values.conversions;
  }

  async updateTargetAdsLink(targetId: string, link: AdLabAdsLink) {
    const found = this.locate(targetId);
    if (!found) return;
    found.target.ads = structuredClone(link);
  }

  async updateTargetAdsMetrics(targetId: string, _metrics: Record<string, unknown>) {
    const found = this.locate(targetId);
    if (!found || !found.target.ads) return;
    found.target.ads.lastSyncedAt = new Date().toISOString();
  }
}

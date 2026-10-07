import type { AdLabChannel } from "@/domain/models/AdLab";
import type { AdLabAdsLink } from "@/domain/models/AdLabAdTargeting";
import type {
  AdLabNormalizedMetrics,
  AdLabPublication,
  AdLabPublicationStatus,
  AdLabPublicationTarget,
  AdLabTargetStatus,
} from "@/domain/models/AdLabPublication";

export interface CreateAdLabPublicationInput {
  ownerId: string;
  brandId: string;
  draftId: string;
  planId: string | null;
  campaignName: string;
  caption: string;
  videoKey: string;
  videoName: string;
  targets: Array<{
    channel: AdLabChannel;
    connectionId: string;
    providerAccountId: string;
    platform: string;
    accountLabel: string;
    plannedBudget: number;
  }>;
}

export interface UpdateAdLabTargetOutcome {
  status: AdLabTargetStatus;
  platformPostId?: string | null;
  platformUrl?: string | null;
  error?: string | null;
  publishedAt?: Date | null;
}

export interface IAdLabPublicationRepository {
  create(input: CreateAdLabPublicationInput): Promise<AdLabPublication>;
  findById(id: string): Promise<AdLabPublication | null>;
  listByOwner(ownerId: string, limit?: number): Promise<AdLabPublication[]>;
  findTargetById(targetId: string): Promise<{ ownerId: string; target: AdLabPublicationTarget } | null>;
  setProviderPost(
    id: string,
    providerPostId: string | null,
    status: AdLabPublicationStatus,
    error?: string | null
  ): Promise<void>;
  setStatus(id: string, status: AdLabPublicationStatus, error?: string | null): Promise<void>;
  /** Remove a publication; its targets and metric snapshots go with it. */
  delete(id: string): Promise<void>;
  updateTargetOutcome(targetId: string, outcome: UpdateAdLabTargetOutcome): Promise<void>;
  updateTargetMetrics(
    targetId: string,
    metrics: AdLabNormalizedMetrics,
    raw: Record<string, unknown> | null
  ): Promise<void>;
  updateTargetEconomics(
    targetId: string,
    values: { spend?: number; revenue?: number; conversions?: number }
  ): Promise<void>;
  /** Persist TikTok Ads Manager draft/link fields (migration 040 columns). */
  updateTargetAdsLink(targetId: string, link: AdLabAdsLink): Promise<void>;
  /** Optional: store raw ads reporting metrics JSON. */
  updateTargetAdsMetrics?(targetId: string, metrics: Record<string, unknown>): Promise<void>;
}

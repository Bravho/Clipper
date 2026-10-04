import type { AdLabChannel } from "@/domain/models/AdLab";
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
}

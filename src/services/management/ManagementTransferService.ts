/**
 * ManagementTransferService — copies a completed generation project's channel
 * videos into RClipper Management.
 *
 * FREE AND OPTIONAL. Transferring costs nothing and gates nothing: a user who
 * never transfers keeps the existing download experience unchanged. Payment
 * happens later, at publish time, and is not considered anywhere in this file.
 *
 * IDEMPOTENT BY CONSTRUCTION. Transfer can be triggered more than once (a user
 * clicking twice, a job replay). Every path converges on the same content item
 * because `management_content_items` carries a partial unique index on
 * (user_id, source_generation_id), and the repository returns the existing row
 * rather than inserting a second one.
 *
 * MEDIA IS NOT DUPLICATED. Transferring records references to the existing
 * `uploaded_assets` rows and pins them against the generator's retention sweep.
 * It does not copy bytes, and it does not store signed URLs — those expire in an
 * hour and a scheduled post may go out weeks later, so publish-time code mints a
 * fresh one.
 *
 * The transferred copy gets its OWN, longer retention window
 * (`media_expires_at`), after which the file is purged but the record, the
 * publishing history and any paid unlock survive.
 */

import {
  clipRequestRepository,
  managementContentRepository,
  uploadedAssetRepository,
  videoGenerationJobRepository,
} from "@/repositories";
import {
  managementEntitlementService,
  eligibleExportAssetIds,
} from "@/services/management/ManagementEntitlementService";
import { managementAuditService } from "@/services/management/ManagementAuditService";
import { managementRetainedExpiryFrom } from "@/config/management";
import { estimatedSpaceExpiry } from "@/config/spacesLifecycle";
import { ManagementContentStatus } from "@/domain/enums/ManagementStatus";
import type { ManagementContentItem } from "@/domain/models/ManagementContent";
import type { ManagementChannelSuggestion } from "@/domain/models/ManagementContent";
import type { ManagementTransferEligibility } from "@/domain/models/ManagementEntitlement";
import { shapeChannelCopy } from "@/lib/publishing/channelCopyPolicy";
import { Platform, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";
import { isPublishablePlatform } from "@/config/publishFields";
import type { ChannelPublishingDraft } from "@/domain/models/VideoGenerationJob";

export class ManagementTransferNotAllowedError extends Error {
  constructor(readonly eligibility: ManagementTransferEligibility) {
    super(`Transfer not allowed: ${eligibility.reason ?? "unknown"}`);
    this.name = "ManagementTransferNotAllowedError";
  }
}

export interface TransferResult {
  content: ManagementContentItem;
  /** False when the project had already been transferred. */
  created: boolean;
  assetCount: number;
}

type ChannelSuggestionInput = Omit<
  ManagementChannelSuggestion,
  "id" | "managementContentId" | "createdAt" | "updatedAt"
>;

/**
 * Match the requester's primary-first distribution choices to ONE generated
 * export. A ratio may intentionally map to several channels (Facebook and
 * YouTube both use 16:9), so this always returns a list. Travy/CDN are omitted
 * because they are generator destinations, not connectable Management accounts.
 */
export function buildTransferChannelSuggestions(
  targetPlatforms: readonly Platform[],
  ratio: string | null,
  drafts: readonly ChannelPublishingDraft[]
): ChannelSuggestionInput[] {
  if (!ratio) return [];

  const draftByPlatform = new Map(drafts.map((draft) => [draft.platform, draft]));
  const seen = new Set<string>();
  const suggestions: ChannelSuggestionInput[] = [];

  for (const platform of targetPlatforms) {
    if (seen.has(platform)) continue;
    seen.add(platform);
    if (!isPublishablePlatform(platform)) continue;
    if (PLATFORM_ASPECT_RATIOS[platform] !== ratio) continue;

    const draft = draftByPlatform.get(platform);
    const copy = draft
      ? shapeChannelCopy(platform, {
          title: draft.title,
          caption: draft.caption,
          hashtags: draft.hashtags,
        })
      : null;

    suggestions.push({
      platform,
      displayOrder: suggestions.length,
      title: copy?.title?.trim() || null,
      caption: copy?.caption?.trim() || null,
      hashtags: copy?.hashtags ?? [],
      locale: draft?.locale ?? null,
    });
  }

  return suggestions;
}

export class ManagementTransferService {
  constructor(
    private requests = clipRequestRepository,
    private jobs = videoGenerationJobRepository,
    private assets = uploadedAssetRepository,
    private content = managementContentRepository,
    private entitlements = managementEntitlementService,
    private audit = managementAuditService
  ) {}

  /**
   * Transfer one source generation into Management.
   *
   * Eligibility is re-checked here rather than trusted from the caller — this
   * method is reachable from the API route and (later) the job runner, and each
   * must be independently safe.
   */
  async transfer(params: {
    user: { id: string; email?: string | null; role?: string | null };
    sourceGenerationId: string;
  }): Promise<TransferResult> {
    const { user, sourceGenerationId } = params;

    const eligibility = await this.entitlements.checkTransferEligibility(
      user,
      sourceGenerationId
    );
    if (!eligibility.allowed) {
      throw new ManagementTransferNotAllowedError(eligibility);
    }

    // Already transferred: return the existing item. Not an error — clicking
    // "transfer" twice should simply land the user in Management.
    if (eligibility.alreadyTransferred) {
      const existing = await this.content.findBySource(user.id, sourceGenerationId);
      if (existing) {
        const assets = await this.content.findAssets(existing.id);
        return { content: existing, created: false, assetCount: assets.length };
      }
    }

    await this.audit.record("management.transfer.started", {
      userId: user.id,
      sourceGenerationId,
    });

    try {
      const request = await this.requests.findById(sourceGenerationId);
      if (!request) throw new Error("Source generation not found.");
      // Re-check ownership at the point of writing, not only at evaluation.
      if (request.userId !== user.id) throw new Error("Access denied.");

      const job = await this.jobs.findByRequestId(sourceGenerationId);
      if (!job) throw new Error("Source generation has no production job.");

      const exports = eligibleExportAssetIds(job);
      if (exports.length === 0) throw new Error("Source generation has no eligible media.");

      // Resolve every export to its asset row, dropping any that no longer exist
      // (retention may have purged an old project) and verifying each belongs to
      // this user — media ownership is validated, never assumed.
      const resolved = await Promise.all(
        exports.map(async (e) => {
          const asset = await this.assets.findById(e.assetId);
          if (!asset) return null;
          if (asset.userId !== user.id || asset.requestId !== sourceGenerationId) {
            return null;
          }
          if (!asset.storageKey) return null;
          return { ...e, asset };
        })
      );
      const usable = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
      if (usable.length === 0) {
        throw new Error(
          "The generated videos for this project are no longer available in storage."
        );
      }

      const thumbnailKey =
        usable.find((u) => u.asset.thumbnailKey)?.asset.thumbnailKey || null;

      // Earliest storage expiry across the transferred exports — a free transfer
      // only lives as long as the underlying generation clips do (their short
      // window). A paid promotion into management_retained/ pushes this out.
      const freeExpiry = usable
        .map((u) => estimatedSpaceExpiry(u.asset.storageKey, u.asset.createdAt))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      const { item, created } = await this.content.createOrGetTransferred({
        userId: user.id,
        sourceGenerationId,
        title: request.title,
        description: request.description ?? null,
        thumbnailStorageKey: thumbnailKey,
        mediaExpiresAt: freeExpiry ?? managementRetainedExpiryFrom(),
      });

      // replaceAssets is a full replace inside one transaction, so re-running
      // converges on the same set rather than accumulating rows. It also pins
      // the generator's media against its own retention sweep.
      const assetRows = await this.content.replaceAssets(
        item.id,
        usable.map((u) => ({
          sourceVideoId: u.asset.id,
          platformVariant: u.variant,
          storageKey: u.asset.storageKey,
          mimeType: u.asset.mimeType ?? null,
          width: null,
          height: null,
          durationSeconds: u.asset.durationSeconds ?? null,
          aspectRatio: u.asset.videoRatio ?? u.ratio ?? null,
          originalFilename: u.asset.fileName ?? null,
          fileSizeBytes: u.asset.fileSizeBytes ?? null,
        }))
      );

      if (item.status !== ManagementContentStatus.Ready) {
        await this.content.updateStatus(item.id, ManagementContentStatus.Ready);
      }

      await this.audit.record("management.transfer.completed", {
        userId: user.id,
        sourceGenerationId,
        managementContentId: item.id,
        metadata: {
          assetCount: assetRows.length,
          created,
          mediaExpiresAt: item.mediaExpiresAt?.toISOString() ?? null,
        },
      });

      return { content: item, created, assetCount: assetRows.length };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error.";
      // Nothing to unwind: no money changed hands. The user may simply retry.
      await this.audit.record("management.transfer.failed", {
        userId: user.id,
        sourceGenerationId,
        metadata: { reason: reason.slice(0, 500), retryable: true },
      });
      throw err;
    }
  }

  /**
   * Transfer ONE generated video (one export/ratio) into Management as its own
   * content item, so each video can be managed and published independently.
   *
   * Idempotent per (user, generation, asset): transferring the same video twice
   * lands on the same item. Ownership of both the project and the specific asset
   * is re-verified here — the asset id arrives from the client and is never
   * trusted.
   */
  async transferVideo(params: {
    user: { id: string; email?: string | null; role?: string | null };
    sourceGenerationId: string;
    assetId: string;
  }): Promise<TransferResult> {
    const { user, sourceGenerationId, assetId } = params;

    const eligibility = await this.entitlements.checkTransferEligibility(
      user,
      sourceGenerationId
    );
    if (!eligibility.allowed) throw new ManagementTransferNotAllowedError(eligibility);

    const request = await this.requests.findById(sourceGenerationId);
    if (!request) throw new Error("Source generation not found.");
    if (request.userId !== user.id) throw new Error("Access denied.");

    const job = await this.jobs.findByRequestId(sourceGenerationId);
    if (!job) throw new Error("Source generation has no production job.");

    // The requested asset must be one of THIS project's eligible exports —
    // otherwise a client could name any asset id.
    const target = eligibleExportAssetIds(job).find((e) => e.assetId === assetId);
    if (!target) throw new Error("That video is not an eligible export for this project.");

    const asset = await this.assets.findById(assetId);
    if (
      !asset ||
      asset.userId !== user.id ||
      asset.requestId !== sourceGenerationId ||
      !asset.storageKey
    ) {
      throw new Error("The generated video is no longer available in storage.");
    }

    await this.audit.record("management.transfer.started", {
      userId: user.id,
      sourceGenerationId,
    });

    // Snapshot every selected channel served by this exact export. Suggestions
    // remain optional in Management, but retaining their individual copy avoids
    // collapsing Facebook/YouTube (a shared 16:9 file) into one arbitrary draft.
    const channelSuggestions = buildTransferChannelSuggestions(
      request.targetPlatforms ?? [],
      target.ratio,
      job.publishingDrafts ?? []
    );

    // The first matching suggestion is also the video's generic fallback. A
    // non-suggested channel can still be chosen later and starts from this copy.
    const suggestedDefault = channelSuggestions.find((suggestion) => suggestion.caption);
    const draft = suggestedDefault
      ? null
      : job.publishingDrafts?.find((candidate) => candidate.caption?.trim()) ?? null;
    const normalizedDraft = draft
      ? shapeChannelCopy(draft.platform, {
          title: draft.title,
          caption: draft.caption,
          hashtags: draft.hashtags,
        })
      : null;
    const defaultCaption =
      suggestedDefault?.caption || normalizedDraft?.caption?.trim() || job.captionThai || null;
    const defaultHashtags = suggestedDefault?.hashtags ?? normalizedDraft?.hashtags ?? [];

    try {
      const { item, created } = await this.content.createOrGetTransferredVideo({
        userId: user.id,
        sourceGenerationId,
        sourceAssetId: assetId,
        title: `${request.title} · ${target.variant}`,
        description: request.description ?? null,
        defaultCaption,
        defaultHashtags,
        thumbnailStorageKey: asset.thumbnailKey ?? null,
        // A free transfer keeps referencing the generation export, so the item's
        // media only lives as long as that clip's own (short) storage window.
        // Reflect that honestly; a paid promotion into management_retained/ later
        // pushes this out to the 30-day window.
        mediaExpiresAt:
          estimatedSpaceExpiry(asset.storageKey, asset.createdAt) ??
          managementRetainedExpiryFrom(),
      });

      const assetRows = await this.content.replaceAssets(item.id, [
        {
          sourceVideoId: asset.id,
          platformVariant: target.variant,
          storageKey: asset.storageKey,
          mimeType: asset.mimeType ?? null,
          width: null,
          height: null,
          durationSeconds: asset.durationSeconds ?? null,
          aspectRatio: asset.videoRatio ?? target.ratio ?? null,
          originalFilename: asset.fileName ?? null,
          fileSizeBytes: asset.fileSizeBytes ?? null,
        },
      ]);
      const suggestionRows = await this.content.replaceChannelSuggestions(
        item.id,
        channelSuggestions
      );

      if (item.status !== ManagementContentStatus.Ready) {
        await this.content.updateStatus(item.id, ManagementContentStatus.Ready);
      }

      await this.audit.record("management.transfer.completed", {
        userId: user.id,
        sourceGenerationId,
        managementContentId: item.id,
        metadata: {
          assetCount: assetRows.length,
          suggestionCount: suggestionRows.length,
          created,
          variant: target.variant,
        },
      });

      return { content: item, created, assetCount: assetRows.length };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error.";
      await this.audit.record("management.transfer.failed", {
        userId: user.id,
        sourceGenerationId,
        metadata: { reason: reason.slice(0, 500), assetId, retryable: true },
      });
      throw err;
    }
  }

  /**
   * Transfer EVERY eligible generated video of a project, each as its own item.
   *
   * A best-effort loop: an export that has been purged from storage is skipped
   * so the rest still transfer. Throws only when nothing at all could be moved.
   */
  async transferAll(params: {
    user: { id: string; email?: string | null; role?: string | null };
    sourceGenerationId: string;
  }): Promise<{ items: TransferResult[]; createdCount: number }> {
    const { user, sourceGenerationId } = params;

    const eligibility = await this.entitlements.checkTransferEligibility(
      user,
      sourceGenerationId
    );
    if (!eligibility.allowed) throw new ManagementTransferNotAllowedError(eligibility);

    const job = await this.jobs.findByRequestId(sourceGenerationId);
    if (!job) throw new Error("Source generation has no production job.");

    const exports = eligibleExportAssetIds(job);
    if (exports.length === 0) {
      throw new Error("Source generation has no eligible media.");
    }

    const items: TransferResult[] = [];
    let createdCount = 0;
    for (const e of exports) {
      try {
        const result = await this.transferVideo({
          user,
          sourceGenerationId,
          assetId: e.assetId,
        });
        items.push(result);
        if (result.created) createdCount += 1;
      } catch {
        // A single unavailable export must not fail the whole batch.
      }
    }

    if (items.length === 0) {
      throw new Error(
        "The generated videos for this project are no longer available in storage."
      );
    }
    return { items, createdCount };
  }
}

export const managementTransferService = new ManagementTransferService();

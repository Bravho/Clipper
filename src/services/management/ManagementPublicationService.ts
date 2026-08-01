/**
 * ManagementPublicationService — turns a paid-for content item into real posts
 * on the user's own social channels.
 *
 * WHERE IT SITS. This is the step immediately AFTER the paid gate. It never
 * takes money (that is `/api/management/checkout` alone); instead it re-asks
 * `evaluateForPublish` and refuses if the user is not entitled, so the frontend
 * is never the authority on whether a publish may happen.
 *
 * THE ORDER OF OPERATIONS IS DELIBERATE AND LO­AD-BEARING:
 *   1. validate ownership of the content, every connection, and every variant;
 *   2. re-check entitlement — refuse (never charge) when payment is required;
 *   3. write the publication and one target per destination BEFORE the provider
 *      is called, so a crash mid-send leaves an auditable, retryable record;
 *   4. mint a FRESH signed media URL at send time (never persisted — a scheduled
 *      post may fire weeks later, long after any earlier URL expired);
 *   5. call the provider, grouping destinations that share a video variant into
 *      one post; map each result back onto its target;
 *   6. derive the publication's rolled-up status from its targets.
 *
 * ONE POST PER VARIANT. The provider sends a single media array to all accounts
 * in a post, so destinations that use DIFFERENT video variants (a 9:16 export to
 * TikTok, a 16:9 export to YouTube) must be separate provider posts. Targets are
 * grouped by content asset; one `createPost` per group. A user upload is one
 * video for one channel, so it is simply a group of one.
 *
 * PROVIDER CALLS ARE NOT RETRIED HERE. A create that times out may have
 * succeeded, and retrying could publish the same video twice — the one failure
 * users never forgive. A failed group marks its own targets failed and the other
 * groups proceed; reconciliation (a later job) is how a genuinely-lost post is
 * recovered, never a blind retry.
 */

import {
  managementContentRepository,
  socialConnectionRepository,
  managementPublicationRepository,
  managementJobRepository,
  managementUploadBundleRepository,
} from "@/repositories";
import { managementEntitlementService } from "@/services/management/ManagementEntitlementService";
import { managementAuditService } from "@/services/management/ManagementAuditService";
import { socialPublishingProvider } from "@/services/social-publishing";
import { SocialPublishingError } from "@/services/social-publishing/errors";
import { spacesSignedUrl, spacesPublicUrl } from "@/lib/spaces";
import {
  aggregatePublicationStatus,
  type CreatePublicationTargetInput,
  type ManagementPublicationTarget,
  type PublicationWithTargets,
} from "@/domain/models/ManagementPublication";
import { hasUsableMedia } from "@/domain/models/ManagementContent";
import {
  ManagementContentStatus,
  ManagementEntitlementType,
  ManagementJobKind,
  ManagementPublicationStatus,
  ManagementPublicationTargetStatus,
  ManagementPublishMode,
  SocialConnectionStatus,
} from "@/domain/enums/ManagementStatus";
import type { ManagementDenialReason } from "@/domain/models/ManagementEntitlement";
import {
  assetAspectRatio,
  isAspectRatioCompatibleWithPlatform,
} from "@/config/managementPublishing";
import {
  composeChannelCopy,
  shapeChannelCopy,
} from "@/lib/publishing/channelCopyPolicy";

/** Raised when the user is not entitled to publish. Carries the machine reason
 * so the route can answer 402/409 and the UI can surface the package picker. */
export class PublishNotEntitledError extends Error {
  constructor(readonly reason: ManagementDenialReason) {
    super("Publishing is not available for this content.");
    this.name = "PublishNotEntitledError";
  }
}

/** Raised for a bad request the user can fix (unknown account, wrong shape,
 * missing/invalid schedule). Maps to 400/409, never a charge. */
export class PublicationValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "no_targets"
      | "duplicate_target"
      | "unknown_asset"
      | "unknown_connection"
      | "connection_not_connected"
      | "aspect_ratio_mismatch"
      | "invalid_schedule"
  ) {
    super(message);
    this.name = "PublicationValidationError";
  }
}

/**
 * Raised for edit/cancel of a publication target. `not_editable` is the load-
 * bearing one: a post that has already started publishing cannot be changed or
 * removed through the provider (nor by the platforms), so the manage-posts UI
 * only offers these actions on a still-scheduled post.
 */
export class PublicationActionError extends Error {
  constructor(
    readonly code: "not_found" | "not_editable" | "provider_error",
    message: string
  ) {
    super(message);
    this.name = "PublicationActionError";
  }
}

/** Editable post copy for a scheduled target. */
export interface EditScheduledCopy {
  caption?: string;
  title?: string | null;
  description?: string | null;
  hashtags?: string[];
}

export interface CreatePublicationRequest {
  managementContentId: string;
  publishMode: ManagementPublishMode;
  /** Required (and must be in the future) when publishMode is scheduled. */
  scheduledAt?: Date | null;
  timezone?: string | null;
  targets: CreatePublicationTargetInput[];
}

/** How long before a scheduled instant a publication must be created. Guards
 * against a race where the provider would fire before it is set up. */
const MIN_SCHEDULE_LEAD_MS = 60_000;

export class ManagementPublicationService {
  constructor(
    private content = managementContentRepository,
    private connections = socialConnectionRepository,
    private publications = managementPublicationRepository,
    private jobs = managementJobRepository,
    private entitlement = managementEntitlementService,
    private provider = socialPublishingProvider,
    private audit = managementAuditService,
    private signUrl = spacesSignedUrl,
    private publicUrl = spacesPublicUrl,
    private bundles = managementUploadBundleRepository
  ) {}

  async create(
    user: { id: string; email?: string | null; role?: string | null },
    req: CreatePublicationRequest,
    now: Date = new Date()
  ): Promise<PublicationWithTargets> {
    // ── 1. Shape checks ──────────────────────────────────────────────────────
    if (req.targets.length === 0) {
      throw new PublicationValidationError(
        "A publication needs at least one destination.",
        "no_targets"
      );
    }
    const seen = new Set<string>();
    for (const t of req.targets) {
      if (seen.has(t.socialConnectionId)) {
        throw new PublicationValidationError(
          "The same account was selected more than once.",
          "duplicate_target"
        );
      }
      seen.add(t.socialConnectionId);
    }

    // ── 2. Ownership + media ─────────────────────────────────────────────────
    const item = await this.content.findById(req.managementContentId);
    if (!item || item.userId !== user.id) {
      // Missing and foreign both look the same — no probing for other users' ids.
      throw new PublishNotEntitledError("not_owner");
    }
    if (!hasUsableMedia(item)) {
      throw new PublishNotEntitledError("media_expired");
    }

    const assets = await this.content.findAssets(item.id);
    const assetById = new Map(assets.map((a) => [a.id, a]));

    // ── 3. Resolve + validate every destination ──────────────────────────────
    const resolved: {
      input: CreatePublicationTargetInput;
      platform: string;
      externalAccountId: string;
      storageKey: string;
    }[] = [];

    for (const t of req.targets) {
      const asset = assetById.get(t.managementContentAssetId);
      if (!asset) {
        throw new PublicationValidationError(
          "A selected video variant does not belong to this content.",
          "unknown_asset"
        );
      }

      const conn = await this.connections.findById(t.socialConnectionId);
      if (!conn || conn.userId !== user.id) {
        throw new PublicationValidationError(
          "A selected account was not found.",
          "unknown_connection"
        );
      }
      if (
        conn.connectionStatus !== SocialConnectionStatus.Connected ||
        !conn.providerAccountId
      ) {
        throw new PublicationValidationError(
          "A selected account is not connected. Reconnect it and try again.",
          "connection_not_connected"
        );
      }

      // The app rechecks that the chosen video's shape fits the channel — a
      // landscape clip must not be sent to a vertical-only surface. A transfer
      // matches each channel to its own ratio; an upload is validated against
      // the single channel it was meant for.
      if (!isAspectRatioCompatibleWithPlatform(conn.platform, assetAspectRatio(asset))) {
        throw new PublicationValidationError(
          `This video's aspect ratio is not suitable for ${conn.platform}.`,
          "aspect_ratio_mismatch"
        );
      }

      resolved.push({
        input: t,
        platform: conn.platform,
        externalAccountId: conn.providerAccountId,
        storageKey: asset.storageKey,
      });
    }

    // ── 4. Schedule validity ─────────────────────────────────────────────────
    const scheduled = req.publishMode === ManagementPublishMode.Scheduled;
    let scheduledAt: Date | null = null;
    if (scheduled) {
      if (!req.scheduledAt) {
        throw new PublicationValidationError(
          "A scheduled publication needs a time.",
          "invalid_schedule"
        );
      }
      if (req.scheduledAt.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
        throw new PublicationValidationError(
          "The scheduled time must be at least a minute in the future.",
          "invalid_schedule"
        );
      }
      scheduledAt = req.scheduledAt;
    }

    // ── 5. The paid gate — refuse, never charge ──────────────────────────────
    // One token is spent per target, so the gate must know how many targets this
    // publish creates. A pass covers any count; tokens must cover all of them.
    const requiredTokens = resolved.length;
    const ent = await this.entitlement.evaluateForPublish(
      user,
      item.id,
      now,
      requiredTokens
    );
    if (!ent.allowed) {
      throw new PublishNotEntitledError(ent.reason ?? "payment_required");
    }
    // Token-based publishing (no pass) must actually SPEND tokens; a pass spends
    // nothing. The entitlement type is the discriminator.
    const usesTokens = ent.entitlementType === ManagementEntitlementType.SingleVideo;

    // ── 6. Persist publication + targets BEFORE any provider call ────────────
    const created = await this.publications.createWithTargets({
      userId: user.id,
      managementContentId: item.id,
      publishMode: req.publishMode,
      scheduledAt,
      timezone: req.timezone ?? null,
      entitlementType: ent.entitlementType,
      accessPassId: ent.accessPassId ?? null,
      publishEntitlementId: ent.publishEntitlementId ?? null,
      targets: resolved.map((r) => ({
        socialConnectionId: r.input.socialConnectionId,
        platform: r.platform,
        caption: r.input.caption ?? "",
        title: r.input.title ?? null,
        description: r.input.description ?? null,
        hashtags: r.input.hashtags ?? [],
        managementContentAssetId: r.input.managementContentAssetId,
        scheduledAt,
      })),
    });

    await this.audit.record("management.publication.created", {
      userId: user.id,
      managementContentId: item.id,
      publicationId: created.publication.id,
      publishEntitlementId: ent.publishEntitlementId ?? null,
      accessPassId: ent.accessPassId ?? null,
      metadata: {
        publishMode: req.publishMode,
        targetCount: created.targets.length,
        entitlementType: ent.entitlementType,
      },
    });

    // ── 6b. Spend one upload token per target, atomically ────────────────────
    // Entitlement is consumed when a publication is CREATED, not when it fires,
    // so scheduled posts spend their tokens now too. `consume` is race-proof: it
    // spends all N or nothing, so a concurrent publish that drained the balance
    // between the gate and here is caught. Each target is stamped with the bundle
    // that paid for it. A pass consumes nothing.
    if (usesTokens) {
      const allocations = await this.bundles.consume(
        user.id,
        created.targets.length,
        now
      );
      if (!allocations) {
        // A concurrent publish drained the tokens after the gate passed. Nothing
        // has been sent yet, so cancel the just-written publication and refuse.
        await this.publications.updateStatus(
          created.publication.id,
          ManagementPublicationStatus.Cancelled
        );
        throw new PublishNotEntitledError("payment_required");
      }
      await Promise.all(
        created.targets.map((t, i) =>
          this.publications.setTargetUploadBundle(t.id, allocations[i])
        )
      );
    }

    // ── 7. Send, one provider post per video variant ─────────────────────────
    const targetByConnection = new Map(
      created.targets.map((t) => [t.socialConnectionId, t])
    );
    const groups = groupBy(resolved, (r) => r.input.managementContentAssetId);

    const finalTargets: ManagementPublicationTarget[] = [];
    let anyLive = false;

    for (const group of groups.values()) {
      // Fresh signed URL, minted now and never stored.
      const mediaUrl = await this.signUrl(group[0].storageKey);
      const thumbnailUrl = item.thumbnailStorageKey
        ? this.publicUrl(item.thumbnailStorageKey)
        : undefined;

      const groupTargets = group
        .map((r) => targetByConnection.get(r.input.socialConnectionId))
        .filter((t): t is ManagementPublicationTarget => !!t);

      try {
        const groupCopy = providerCopy(group[0].platform, group[0].input);
        const result = await this.provider.createPost({
          caption: groupCopy.caption,
          media: [{ url: mediaUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}) }],
          targets: group.map((r) => {
            const copy = providerCopy(r.platform, r.input);
            return {
              externalAccountId: r.externalAccountId,
              platform: r.platform,
              caption: copy.caption,
              ...(copy.title ? { title: copy.title } : {}),
            };
          }),
          scheduledAt,
          externalId: created.publication.id,
        });

        await this.publications.setProviderPostId(
          created.publication.id,
          result.externalPostId
        );

        const nextStatus = scheduled
          ? ManagementPublicationTargetStatus.Scheduled
          : ManagementPublicationTargetStatus.Publishing;

        for (const gt of groupTargets) {
          finalTargets.push(
            await this.publications.updateTarget(gt.id, {
              status: nextStatus,
              providerPostId: result.externalPostId,
            })
          );
        }
        anyLive = true;
      } catch (err) {
        const { code, message } = describeError(err);
        for (const gt of groupTargets) {
          finalTargets.push(
            await this.publications.updateTarget(gt.id, {
              status: ManagementPublicationTargetStatus.Failed,
              errorCode: code,
              errorMessage: message,
            })
          );
        }
      }
    }

    // ── 8. Roll up, mirror to the content item, schedule reconciliation ──────
    const status = aggregatePublicationStatus(finalTargets);
    const publication = await this.publications.updateStatus(
      created.publication.id,
      status
    );

    const contentStatus = CONTENT_STATUS_FOR_PUBLICATION[status];
    if (contentStatus) {
      await this.content.updateStatus(item.id, contentStatus);
    }

    if (anyLive) {
      // The provider tells us how far a post got, never whether each platform
      // accepted the video, so a reconcile job polls for per-destination
      // results. Scheduled posts are reconciled shortly after they fire.
      const runAfter = scheduled && scheduledAt
        ? new Date(scheduledAt.getTime() + MIN_SCHEDULE_LEAD_MS)
        : new Date(now.getTime() + 30_000);
      await this.jobs.enqueue({
        kind: ManagementJobKind.ReconcilePublication,
        dedupeKey: `reconcile:${created.publication.id}`,
        payload: { publicationId: created.publication.id },
        runAfter,
      });
    }

    await this.audit.record(AUDIT_EVENT_FOR_PUBLICATION[status], {
      userId: user.id,
      managementContentId: item.id,
      publicationId: created.publication.id,
      providerPostId: publication.providerPostId,
    });

    return { publication, targets: finalTargets };
  }

  /**
   * Edit the copy of a still-SCHEDULED post, and push the change to the provider.
   *
   * Refuses anything that is not `scheduled` with a provider post id: once a post
   * is publishing or live, neither the provider nor the platform will accept an
   * edit, so the manage-posts UI never offers this for a published post. Editing
   * touches only the one destination; siblings on the same provider post are left
   * exactly as they were.
   */
  async editScheduledTarget(
    user: { id: string },
    publicationId: string,
    targetId: string,
    copy: EditScheduledCopy
  ): Promise<ManagementPublicationTarget> {
    const pub = await this.publications.findById(publicationId);
    if (!pub || pub.userId !== user.id) {
      // Missing and foreign look identical — no probing for other users' ids.
      throw new PublicationActionError("not_found", "Post not found.");
    }
    const targets = await this.publications.findTargets(publicationId);
    const target = targets.find((t) => t.id === targetId);
    if (!target) throw new PublicationActionError("not_found", "Post not found.");

    if (
      target.status !== ManagementPublicationTargetStatus.Scheduled ||
      !target.providerPostId
    ) {
      throw new PublicationActionError(
        "not_editable",
        "Only a scheduled post can be edited; a post that is already live cannot be changed."
      );
    }

    const conn = await this.connections.findById(target.socialConnectionId);
    if (!conn || !conn.providerAccountId) {
      throw new PublicationActionError(
        "not_editable",
        "The channel for this post is no longer connected."
      );
    }

    // Merge: a field the caller omitted keeps its stored value; an explicit
    // value (including "") overwrites it.
    const nextCaption = copy.caption ?? target.caption;
    const nextTitle = copy.title !== undefined ? copy.title : target.title;
    const nextDescription =
      copy.description !== undefined ? copy.description : target.description;
    const nextHashtags = copy.hashtags ?? target.hashtags;

    const composed = providerCopy(target.platform, {
      socialConnectionId: target.socialConnectionId,
      managementContentAssetId: target.managementContentAssetId ?? "",
      caption: nextCaption,
      title: nextTitle,
      description: nextDescription,
      hashtags: nextHashtags,
    });

    try {
      await this.provider.updatePost({
        externalPostId: target.providerPostId,
        targets: [
          {
            externalAccountId: conn.providerAccountId,
            platform: target.platform,
            caption: composed.caption,
            ...(composed.title ? { title: composed.title } : {}),
          },
        ],
      });
    } catch {
      throw new PublicationActionError(
        "provider_error",
        "The post could not be edited. Please try again."
      );
    }

    const updated = await this.publications.updateTarget(targetId, {
      caption: nextCaption,
      title: nextTitle,
      description: nextDescription,
      hashtags: nextHashtags,
    });

    await this.audit.record("management.publication.edited", {
      userId: user.id,
      managementContentId: pub.managementContentId,
      publicationId: pub.id,
      providerPostId: target.providerPostId,
      metadata: { platform: target.platform, targetId },
    });

    return updated;
  }

  /**
   * Cancel a still-SCHEDULED post at the provider before it fires.
   *
   * The provider post is one unit: destinations that share the same
   * `provider_post_id` (the same video variant fanned to several accounts) are
   * deleted together, so every sibling is cancelled in lockstep and the parent
   * status is re-derived. Refuses anything already publishing or live — that
   * cannot be undone through the API.
   */
  async cancelScheduledTarget(
    user: { id: string },
    publicationId: string,
    targetId: string
  ): Promise<void> {
    const pub = await this.publications.findById(publicationId);
    if (!pub || pub.userId !== user.id) {
      throw new PublicationActionError("not_found", "Post not found.");
    }
    const targets = await this.publications.findTargets(publicationId);
    const target = targets.find((t) => t.id === targetId);
    if (!target) throw new PublicationActionError("not_found", "Post not found.");

    if (
      target.status !== ManagementPublicationTargetStatus.Scheduled ||
      !target.providerPostId
    ) {
      throw new PublicationActionError(
        "not_editable",
        "Only a scheduled post can be deleted; a post that is already live cannot be removed via the API."
      );
    }

    try {
      await this.provider.cancelPost(target.providerPostId);
    } catch {
      throw new PublicationActionError(
        "provider_error",
        "The post could not be deleted. Please try again."
      );
    }

    const siblings = targets.filter(
      (t) => t.providerPostId === target.providerPostId
    );
    const cancelled = await Promise.all(
      siblings.map((t) =>
        this.publications.updateTarget(t.id, {
          status: ManagementPublicationTargetStatus.Cancelled,
        })
      )
    );

    // Re-derive the rolled-up status from the refreshed target set, then mirror
    // it onto the content item so counts stay consistent.
    const refreshed = targets.map(
      (t) => cancelled.find((c) => c.id === t.id) ?? t
    );
    const status = aggregatePublicationStatus(refreshed);
    await this.publications.updateStatus(pub.id, status);

    const contentStatus = CONTENT_STATUS_FOR_PUBLICATION[status];
    if (contentStatus) {
      await this.content.updateStatus(pub.managementContentId, contentStatus);
    }

    await this.audit.record("management.publication.cancelled", {
      userId: user.id,
      managementContentId: pub.managementContentId,
      publicationId: pub.id,
      providerPostId: target.providerPostId,
      metadata: {
        platform: target.platform,
        targetId,
        cancelledCount: siblings.length,
      },
    });
  }
}

/** Map a rolled-up publication status onto the content item's status, so the
 * library and overview counts reflect what is happening to the video. */
const CONTENT_STATUS_FOR_PUBLICATION: Partial<
  Record<ManagementPublicationStatus, ManagementContentStatus>
> = {
  [ManagementPublicationStatus.Scheduled]: ManagementContentStatus.Scheduled,
  [ManagementPublicationStatus.Publishing]: ManagementContentStatus.Publishing,
  [ManagementPublicationStatus.PartiallyPublished]:
    ManagementContentStatus.PartiallyPublished,
  [ManagementPublicationStatus.Published]: ManagementContentStatus.Published,
  [ManagementPublicationStatus.Failed]: ManagementContentStatus.Failed,
  [ManagementPublicationStatus.Cancelled]: ManagementContentStatus.Cancelled,
};

const AUDIT_EVENT_FOR_PUBLICATION: Record<
  ManagementPublicationStatus,
  Parameters<typeof managementAuditService.record>[0]
> = {
  [ManagementPublicationStatus.Draft]: "management.publication.created",
  [ManagementPublicationStatus.Scheduled]: "management.publication.scheduled",
  [ManagementPublicationStatus.Publishing]: "management.publication.publishing",
  [ManagementPublicationStatus.PartiallyPublished]:
    "management.publication.partially_published",
  [ManagementPublicationStatus.Published]: "management.publication.published",
  [ManagementPublicationStatus.Failed]: "management.publication.failed",
  [ManagementPublicationStatus.Cancelled]: "management.publication.failed",
};

/**
 * Convert the structured form fields into the provider's post shape.
 *
 * RClipper keeps description and hashtags separate so they can be edited and
 * reused. The publishing provider accepts one caption string, so compose the
 * final copy only at this outbound boundary.
 */
function providerCopy(
  platform: string,
  input: CreatePublicationTargetInput
): { title: string; caption: string } {
  const shaped = shapeChannelCopy(platform, {
    title: input.title ?? "",
    caption: input.description ?? input.caption ?? "",
    hashtags: input.hashtags ?? [],
  });
  return {
    title: shaped.title ?? "",
    caption: composeChannelCopy(shaped.caption, shaped.hashtags),
  };
}

/** Stable, non-raw error code + message for a failed provider send. */
function describeError(err: unknown): { code: string; message: string } {
  if (err instanceof SocialPublishingError) {
    return { code: err.code, message: err.message };
  }
  return {
    code: "unknown",
    message: err instanceof Error ? err.message : "The post could not be sent.",
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export const managementPublicationService = new ManagementPublicationService();

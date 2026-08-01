/**
 * ManagementReconcileService — turn a provider's post status into per-destination
 * results on our own records.
 *
 * WHY THIS EXISTS. `createPost` tells us only how far the provider got with a
 * post as a whole ("processing" / "processed"), never whether each individual
 * platform accepted the video. The truth arrives afterwards, so a reconcile job
 * polls `getPostStatus` and writes each destination's real outcome back onto its
 * target row, then rolls the publication (and the content item) up to match.
 *
 * IDEMPOTENT BY CONSTRUCTION. It only ever reads provider status and writes the
 * derived outcome, so running it twice — a webhook redelivery, a reclaimed job —
 * converges on the same rows. It never calls `createPost`, so it can never
 * publish anything a second time.
 *
 * NOT DONE YET? A publication with a destination still `publishing` or
 * `scheduled` (the provider has not reported it) returns `done: false` so the
 * worker re-queues with backoff. Once every live destination is terminal
 * (published or failed), it returns `done: true` and the job completes.
 */

import {
  managementPublicationRepository,
  socialConnectionRepository,
  managementContentRepository,
} from "@/repositories";
import { managementAuditService } from "@/services/management/ManagementAuditService";
import { socialPublishingProvider } from "@/services/social-publishing";
import {
  aggregatePublicationStatus,
  type ManagementPublicationTarget,
} from "@/domain/models/ManagementPublication";
import {
  ManagementContentStatus,
  ManagementPublicationStatus,
  ManagementPublicationTargetStatus,
} from "@/domain/enums/ManagementStatus";

/** Terminal target states — nothing further will change for these. */
const TERMINAL_TARGET_STATES: ReadonlySet<ManagementPublicationTargetStatus> = new Set([
  ManagementPublicationTargetStatus.Published,
  ManagementPublicationTargetStatus.Failed,
  ManagementPublicationTargetStatus.Cancelled,
]);

/** Roll a publication status onto the content item, so library counts follow. */
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

export interface ReconcileResult {
  /** True when every live destination has reached a terminal state. */
  done: boolean;
  status: ManagementPublicationStatus;
}

export class ManagementReconcileService {
  constructor(
    private publications = managementPublicationRepository,
    private connections = socialConnectionRepository,
    private content = managementContentRepository,
    private provider = socialPublishingProvider,
    private audit = managementAuditService
  ) {}

  async reconcile(publicationId: string, now: Date = new Date()): Promise<ReconcileResult> {
    const publication = await this.publications.findById(publicationId);
    if (!publication) {
      // Nothing to reconcile — treat as done so the job does not retry forever.
      return { done: true, status: ManagementPublicationStatus.Cancelled };
    }

    const targets = await this.publications.findTargets(publicationId);

    // Each target carries the provider post id of the variant-group it belongs
    // to. A publication with two variants has two provider posts, so poll each.
    const postIds = [
      ...new Set(
        targets
          .map((t) => t.providerPostId)
          .filter((id): id is string => !!id)
      ),
    ];

    for (const postId of postIds) {
      let status;
      try {
        status = await this.provider.getPostStatus(postId);
      } catch {
        // A transient read failure: leave the group as-is and let the worker
        // retry. Reconciliation NEVER republishes, so retrying is always safe.
        continue;
      }

      // Map each provider result to the target whose connection owns that
      // provider account. The provider account id is not stored on the target,
      // so resolve it through the social connection.
      const groupTargets = targets.filter((t) => t.providerPostId === postId);
      const accountIdByTarget = await this.resolveAccountIds(groupTargets);

      for (const result of status.results) {
        const target = groupTargets.find(
          (t) => accountIdByTarget.get(t.id) === result.externalAccountId
        );
        if (!target) continue;
        if (TERMINAL_TARGET_STATES.has(target.status)) continue;

        if (result.success) {
          await this.publications.updateTarget(target.id, {
            status: ManagementPublicationTargetStatus.Published,
            providerResultId: result.externalResultId,
            publishedUrl: result.publishedUrl ?? null,
            publishedAt: now,
          });
        } else {
          await this.publications.updateTarget(target.id, {
            status: ManagementPublicationTargetStatus.Failed,
            providerResultId: result.externalResultId,
            errorCode: result.error?.code ?? "unknown",
            errorMessage: result.error?.message ?? "The platform rejected the post.",
          });
        }
      }
    }

    // Re-read and roll up.
    const finalTargets = await this.publications.findTargets(publicationId);
    const rolled = aggregatePublicationStatus(finalTargets);
    await this.publications.updateStatus(publicationId, rolled);

    const contentStatus = CONTENT_STATUS_FOR_PUBLICATION[rolled];
    if (contentStatus) {
      await this.content.updateStatus(publication.managementContentId, contentStatus);
    }

    const done = finalTargets.every((t) => TERMINAL_TARGET_STATES.has(t.status));

    if (done) {
      await this.audit.record(
        rolled === ManagementPublicationStatus.Published
          ? "management.publication.published"
          : rolled === ManagementPublicationStatus.PartiallyPublished
            ? "management.publication.partially_published"
            : rolled === ManagementPublicationStatus.Failed
              ? "management.publication.failed"
              : "management.publication.publishing",
        {
          managementContentId: publication.managementContentId,
          publicationId,
          providerPostId: publication.providerPostId,
        }
      );
    }

    return { done, status: rolled };
  }

  /** Resolve each target's connection to its provider account id. */
  private async resolveAccountIds(
    targets: ManagementPublicationTarget[]
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    await Promise.all(
      targets.map(async (t) => {
        const conn = await this.connections.findById(t.socialConnectionId);
        out.set(t.id, conn?.providerAccountId ?? null);
      })
    );
    return out;
  }
}

export const managementReconcileService = new ManagementReconcileService();

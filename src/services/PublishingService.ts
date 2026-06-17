import { PublishingLink } from "@/domain/models/PublishingLink";
import { Platform } from "@/domain/enums/Platform";
import {
  clipRequestRepository,
  publishingLinkRepository,
  requestStatusHistoryRepository,
} from "@/repositories";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { requestWorkflowService } from "./RequestWorkflowService";
import { z } from "zod";

/**
 * PublishingService — manages recording of publishing links and delivery confirmation.
 *
 * Business rules:
 * - Publishing links are recorded manually by staff — no social API integration.
 * - Staff enter the URL for each platform after uploading/posting the clip externally.
 * - A request can be marked Published once at least one link is recorded.
 * - A request is marked Delivered after all intended channels are confirmed.
 * - Links are shown to requesters on delivery.
 *
 * TODO: DigitalOcean Spaces — final clips are stored in DO Spaces under
 *   `clips/{userId}/{date}/{requestId}/{filename}`.
 *   This service would later generate presigned download URLs for staff to use
 *   when uploading to social channels, rather than manually downloading and re-uploading.
 *
 * TODO: Admin Portal — admins can view and manage all publishing links.
 *
 * TODO: Future publishing automation — if social platform APIs are integrated later,
 *   this service would orchestrate posting and auto-record the result URLs.
 *   The PublishingLink repository and data model are already designed for this.
 */

export const addPublishingLinkSchema = z.object({
  platform: z.nativeEnum(Platform, { message: "Invalid platform." }),
  url: z
    .string()
    .trim()
    .url("Must be a valid URL.")
    .max(2000, "URL is too long."),
});

export class PublishingService {
  /**
   * Record a publishing link for a specific platform.
   * The request must be in Scheduled for Publishing or Published status.
   */
  async addPublishingLink(
    requestId: string,
    platform: Platform,
    url: string
  ): Promise<PublishingLink> {
    const parsed = addPublishingLinkSchema.safeParse({ platform, url });
    if (!parsed.success) {
      throw new Error(parsed.error.errors[0]?.message ?? "Invalid link data.");
    }

    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);

    const allowed = new Set([
      RequestStatus.ScheduledForPublishing,
      RequestStatus.Published,
    ]);
    if (!allowed.has(request.status)) {
      throw new Error(
        `Cannot add publishing links to a request in status: ${request.status}`
      );
    }

    const existing = await publishingLinkRepository.findByRequestId(requestId);
    const duplicate = existing.find((l) => l.platform === platform);
    if (duplicate) {
      throw new Error(
        `A publishing link for ${platform} already exists on this request. Remove it first or update it.`
      );
    }

    return publishingLinkRepository.create({
      requestId,
      platform: parsed.data.platform,
      url: parsed.data.url,
      publishedAt: new Date(),
    });
  }

  /**
   * Remove a publishing link by ID.
   */
  async removePublishingLink(linkId: string): Promise<void> {
    return publishingLinkRepository.delete(linkId);
  }

  /**
   * Get all publishing links for a request.
   */
  async getLinksForRequest(requestId: string): Promise<PublishingLink[]> {
    return publishingLinkRepository.findByRequestId(requestId);
  }

  /**
   * Mark a request as Published.
   * Requires at least one publishing link to exist.
   */
  async markPublished(requestId: string, note?: string): Promise<void> {
    const links = await publishingLinkRepository.findByRequestId(requestId);
    if (links.length === 0) {
      throw new Error(
        "At least one publishing link must be recorded before marking as Published."
      );
    }
    await requestWorkflowService.approveForPublishing(requestId, note);
  }

  /**
   * Mark a request as Delivered.
   * Confirms full delivery to the requester.
   */
  async markDelivered(requestId: string, note?: string): Promise<void> {
    await requestWorkflowService.markDelivered(requestId, note);
  }

  /**
   * Get a summary of publishing completeness for a request.
   */
  async getPublishingSummary(requestId: string): Promise<{
    totalLinks: number;
    platforms: Platform[];
    allLinksRecorded: boolean;
    links: PublishingLink[];
  }> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);

    const links = await publishingLinkRepository.findByRequestId(requestId);
    const recordedPlatforms = links.map((l) => l.platform);

    const targetPlatforms = request.targetPlatforms.filter(
      (p) => p !== Platform.CDN // CDN is a delivery mechanism, not a social platform
    );

    const allLinksRecorded =
      targetPlatforms.length > 0 &&
      targetPlatforms.every((p) => recordedPlatforms.includes(p));

    return {
      totalLinks: links.length,
      platforms: recordedPlatforms,
      allLinksRecorded,
      links,
    };
  }
}

// Singleton instance
export const publishingService = new PublishingService();

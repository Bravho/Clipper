import { Platform } from "@/domain/enums/Platform";

/**
 * A published link for a delivered clip request.
 *
 * Staff creates publishing link records when they publish the final clip
 * to a platform. Requesters see these links on the Request Detail page.
 *
 * TODO: PostgreSQL — map to `publishing_links` table.
 *   Columns: id, request_id (FK → clip_requests.id), platform TEXT, url TEXT,
 *            published_at TIMESTAMPTZ, created_at TIMESTAMPTZ
 *
 * TODO: Future — this may eventually connect to a publishing automation service
 *   that creates these records automatically via social media API integrations.
 */
export interface PublishingLink {
  id: string;
  requestId: string;
  platform: Platform;
  /** The published URL (e.g., TikTok video URL, YouTube link, CDN URL). */
  url: string;
  publishedAt: Date;
  createdAt: Date;
}

export type CreatePublishingLinkInput = Omit<PublishingLink, "id" | "createdAt">;

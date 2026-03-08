import {
  PublishingLink,
  CreatePublishingLinkInput,
} from "@/domain/models/PublishingLink";

/**
 * Repository contract for PublishingLink persistence.
 *
 * TODO: PostgreSQL — implement PostgresPublishingLinkRepository.
 *   Index on request_id for fast delivery link lookups.
 *
 * TODO: Future — when publishing automation is implemented, this repository
 *   will be populated automatically via social media API integrations.
 *   Staff will no longer need to manually enter links.
 */
export interface IPublishingLinkRepository {
  findByRequestId(requestId: string): Promise<PublishingLink[]>;
  create(input: CreatePublishingLinkInput): Promise<PublishingLink>;
  deleteByRequestId(requestId: string): Promise<void>;
}

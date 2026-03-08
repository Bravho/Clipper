import { IPublishingLinkRepository } from "@/repositories/interfaces/IPublishingLinkRepository";
import {
  PublishingLink,
  CreatePublishingLinkInput,
} from "@/domain/models/PublishingLink";
import { SEED_PUBLISHING_LINKS } from "@/seed/requestSeedData";

// TODO: PostgreSQL — replace with PostgresPublishingLinkRepository.
// TODO: Future — when publishing automation is implemented, this repository
//   will receive data from social media API webhook handlers.

declare global {
  // eslint-disable-next-line no-var
  var __mockPublishingLinkStore: Map<string, PublishingLink> | undefined;
}

function getStore(): Map<string, PublishingLink> {
  if (!global.__mockPublishingLinkStore) {
    global.__mockPublishingLinkStore = new Map();
    SEED_PUBLISHING_LINKS.forEach((l) =>
      global.__mockPublishingLinkStore!.set(l.id, { ...l })
    );
  }
  return global.__mockPublishingLinkStore;
}

export class MockPublishingLinkRepository implements IPublishingLinkRepository {
  private store: Map<string, PublishingLink>;

  constructor(store?: Map<string, PublishingLink>) {
    this.store = store ?? getStore();
  }

  async findByRequestId(requestId: string): Promise<PublishingLink[]> {
    return [...this.store.values()]
      .filter((l) => l.requestId === requestId)
      .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
  }

  async create(input: CreatePublishingLinkInput): Promise<PublishingLink> {
    const link: PublishingLink = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    this.store.set(link.id, link);
    return { ...link };
  }

  async deleteByRequestId(requestId: string): Promise<void> {
    for (const [id, link] of this.store.entries()) {
      if (link.requestId === requestId) {
        this.store.delete(id);
      }
    }
  }
}

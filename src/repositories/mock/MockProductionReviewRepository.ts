import { IProductionReviewRepository } from "@/repositories/interfaces/IProductionReviewRepository";
import {
  ProductionReview,
  CreateProductionReviewInput,
  UpdateProductionReviewInput,
} from "@/domain/models/ProductionReview";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";

// TODO: PostgreSQL — replace this entire class with PostgresProductionReviewRepository.
//   The interface contract (IProductionReviewRepository) stays the same.
//   Remove the globalThis singleton pattern and use the db pool from @/lib/db instead.

declare global {
  // eslint-disable-next-line no-var
  var __mockProductionReviewStore: Map<string, ProductionReview> | undefined;
}

function getStore(): Map<string, ProductionReview> {
  if (!global.__mockProductionReviewStore) {
    global.__mockProductionReviewStore = new Map();
  }
  return global.__mockProductionReviewStore;
}

export class MockProductionReviewRepository implements IProductionReviewRepository {
  private store: Map<string, ProductionReview>;

  constructor(store?: Map<string, ProductionReview>) {
    this.store = store ?? getStore();
  }

  async findById(id: string): Promise<ProductionReview | null> {
    const review = this.store.get(id);
    return review ? { ...review } : null;
  }

  async findByRequestId(requestId: string): Promise<ProductionReview[]> {
    return [...this.store.values()]
      .filter((r) => r.requestId === requestId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findLatestByRequestId(requestId: string): Promise<ProductionReview | null> {
    const records = await this.findByRequestId(requestId);
    return records[0] ?? null;
  }

  async findByStatus(status: ProductionReviewStatus): Promise<ProductionReview[]> {
    return [...this.store.values()]
      .filter((r) => r.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // oldest pending first
  }

  async create(input: CreateProductionReviewInput): Promise<ProductionReview> {
    const review: ProductionReview = {
      id: crypto.randomUUID(),
      requestId: input.requestId,
      status: ProductionReviewStatus.Pending,
      reviewedBy: null,
      reviewNote: null,
      submittedAt: input.submittedAt,
      reviewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(review.id, review);
    return { ...review };
  }

  async update(id: string, input: UpdateProductionReviewInput): Promise<ProductionReview> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`ProductionReview not found: ${id}`);
    const now = new Date();
    const updated: ProductionReview = {
      ...existing,
      status: input.status,
      reviewedBy: input.reviewedBy,
      reviewNote: input.reviewNote?.trim() ?? existing.reviewNote,
      reviewedAt: now,
      updatedAt: now,
    };
    this.store.set(id, updated);
    return { ...updated };
  }
}

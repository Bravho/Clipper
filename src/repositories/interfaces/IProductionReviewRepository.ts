import {
  ProductionReview,
  CreateProductionReviewInput,
  UpdateProductionReviewInput,
} from "@/domain/models/ProductionReview";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";

/**
 * Repository contract for ProductionReview persistence.
 *
 * TODO: PostgreSQL — implement PostgresProductionReviewRepository.
 *   Replace MockProductionReviewRepository in src/repositories/index.ts.
 */
export interface IProductionReviewRepository {
  findById(id: string): Promise<ProductionReview | null>;

  /**
   * Find all production review records for a request, newest first.
   * A request may have multiple records if it was returned and resubmitted.
   */
  findByRequestId(requestId: string): Promise<ProductionReview[]>;

  /**
   * Find the most recent (active) production review for a request.
   * Returns null if the request has never been submitted for production review.
   * TODO: PostgreSQL — SELECT * FROM production_reviews
   *   WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1
   */
  findLatestByRequestId(requestId: string): Promise<ProductionReview | null>;

  /**
   * Find all production review records with a given status.
   * Used by admin queue views (e.g., show all Pending reviews).
   * TODO: PostgreSQL — SELECT * FROM production_reviews WHERE status = $1
   *   ORDER BY created_at ASC
   */
  findByStatus(status: ProductionReviewStatus): Promise<ProductionReview[]>;

  /** Create a new production review when staff submits a clip for review. */
  create(input: CreateProductionReviewInput): Promise<ProductionReview>;

  /** Update a production review record when admin approves, returns, holds, or rejects. */
  update(id: string, input: UpdateProductionReviewInput): Promise<ProductionReview>;
}

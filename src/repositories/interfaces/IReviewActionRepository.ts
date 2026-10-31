import { ReviewAction, CreateReviewActionInput } from '@/domain/models/ReviewAction';

export interface IReviewActionRepository {
  create(input: CreateReviewActionInput): Promise<ReviewAction>;
  listByItem(reviewItemId: string): Promise<ReviewAction[]>;
}

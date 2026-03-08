import {
  ClipRequest,
  CreateClipRequestInput,
  UpdateClipRequestInput,
} from "@/domain/models/ClipRequest";
import { RequestStatus } from "@/domain/enums/RequestStatus";

/**
 * Repository contract for ClipRequest persistence.
 *
 * TODO: PostgreSQL — implement PostgresClipRequestRepository.
 *   Use transactions when updating status + logging status history together.
 *   Consider SELECT FOR UPDATE when updating status to prevent race conditions.
 *   Index: (user_id, status) for efficient dashboard queries.
 *   Index: (status) for staff queue queries (future).
 */
export interface IClipRequestRepository {
  findById(id: string): Promise<ClipRequest | null>;
  findByUserId(userId: string): Promise<ClipRequest[]>;
  findByUserIdAndStatus(
    userId: string,
    statuses: RequestStatus[]
  ): Promise<ClipRequest[]>;
  create(input: CreateClipRequestInput): Promise<ClipRequest>;
  update(id: string, input: UpdateClipRequestInput): Promise<ClipRequest>;
  updateStatus(
    id: string,
    status: RequestStatus,
    extra?: Partial<
      Pick<
        ClipRequest,
        | "holdReason"
        | "rejectionReason"
        | "confirmedDueDate"
        | "dueDateConfirmed"
        | "estimatedDueDate"
        | "queuePosition"
        | "submittedAt"
        | "creditConfirmed"
        | "rightsConfirmed"
      >
    >
  ): Promise<ClipRequest>;
  delete(id: string): Promise<void>;
}

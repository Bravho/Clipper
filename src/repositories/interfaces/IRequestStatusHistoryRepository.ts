import {
  RequestStatusHistory,
  CreateStatusHistoryInput,
} from "@/domain/models/RequestStatusHistory";

/**
 * Repository contract for RequestStatusHistory persistence.
 *
 * TODO: PostgreSQL — implement PostgresRequestStatusHistoryRepository.
 *   Always append-only — no updates or deletes to preserve audit trail.
 *   Index on request_id for fast history retrieval.
 */
export interface IRequestStatusHistoryRepository {
  findByRequestId(requestId: string): Promise<RequestStatusHistory[]>;
  create(input: CreateStatusHistoryInput): Promise<RequestStatusHistory>;
}

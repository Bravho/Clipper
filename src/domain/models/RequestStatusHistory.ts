import { RequestStatus } from "@/domain/enums/RequestStatus";

/**
 * Immutable log entry recording a status change on a clip request.
 *
 * Every status transition is recorded here so the requester portal
 * can show a simplified timeline and staff can audit history.
 *
 * TODO: PostgreSQL — map to `request_status_history` table.
 *   Columns: id, request_id (FK), status TEXT, changed_at TIMESTAMPTZ, note TEXT NULLABLE
 *   Index on request_id for efficient history lookups.
 */
export interface RequestStatusHistory {
  id: string;
  requestId: string;
  status: RequestStatus;
  /** Optional note — visible to staff; may be surfaced to requester (e.g., hold reason). */
  note: string | null;
  changedAt: Date;
}

export type CreateStatusHistoryInput = Omit<RequestStatusHistory, "id">;

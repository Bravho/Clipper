import { IRequestStatusHistoryRepository } from "@/repositories/interfaces/IRequestStatusHistoryRepository";
import {
  RequestStatusHistory,
  CreateStatusHistoryInput,
} from "@/domain/models/RequestStatusHistory";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { pool } from "@/lib/db";

function rowToHistory(row: Record<string, unknown>): RequestStatusHistory {
  return {
    id: row.id as string,
    requestId: row.request_id as string,
    status: row.status as RequestStatus,
    note: (row.note as string) ?? null,
    changedAt: new Date(row.changed_at as string),
  };
}

export class PostgresRequestStatusHistoryRepository
  implements IRequestStatusHistoryRepository
{
  constructor(private db = pool) {}

  async findByRequestId(requestId: string): Promise<RequestStatusHistory[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM request_status_history WHERE request_id = $1 ORDER BY changed_at ASC",
      [requestId]
    );
    return rows.map(rowToHistory);
  }

  async create(input: CreateStatusHistoryInput): Promise<RequestStatusHistory> {
    const { rows } = await this.db.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.requestId, input.status, input.note ?? null, input.changedAt]
    );
    return rowToHistory(rows[0]);
  }
}

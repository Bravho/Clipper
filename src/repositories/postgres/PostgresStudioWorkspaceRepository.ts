import type { StudioStore } from "@/domain/models/Studio";
import type { IStudioWorkspaceRepository, StudioWorkspaceResult } from "@/repositories/interfaces/IStudioWorkspaceRepository";
import { pool } from "@/lib/db";
import type { QueryResult, QueryResultRow } from "pg";
import { isTransientPostgresConnectionError } from "@/lib/postgresErrors";

interface StudioWorkspaceRow {
  data: StudioStore | string;
}

function rowData(row: StudioWorkspaceRow): StudioStore {
  return typeof row.data === "string" ? JSON.parse(row.data) as StudioStore : row.data;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class PostgresStudioWorkspaceRepository implements IStudioWorkspaceRepository {
  constructor(private db = pool) {}

  private async queryWithConnectionRetry<Row extends QueryResultRow>(
    text: string,
    values: unknown[]
  ): Promise<QueryResult<Row>> {
    const retryDelays = [750];
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.db.query<Row>(text, values);
      } catch (error) {
        const delay = retryDelays[attempt];
        if (delay === undefined || !isTransientPostgresConnectionError(error)) throw error;
        await wait(delay);
      }
    }
  }

  async findByOwnerId(ownerId: string): Promise<StudioWorkspaceResult> {
    const { rows } = await this.queryWithConnectionRetry<StudioWorkspaceRow>(
      "SELECT data FROM studio_workspaces WHERE owner_id = $1",
      [ownerId]
    );
    return {
      store: rows[0] ? rowData(rows[0]) : null,
      persistence: "postgresql",
      pendingSync: false,
    };
  }

  async upsert(ownerId: string, data: StudioStore): Promise<StudioWorkspaceResult> {
    const { rows } = await this.queryWithConnectionRetry<StudioWorkspaceRow>(
      `INSERT INTO studio_workspaces (owner_id, data)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (owner_id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()
       RETURNING data`,
      [ownerId, JSON.stringify(data)]
    );
    return { store: rowData(rows[0]), persistence: "postgresql", pendingSync: false };
  }
}

import type { AdLabStore } from "@/domain/models/AdLab";
import type { IAdLabWorkspaceRepository, AdLabWorkspaceResult } from "@/repositories/interfaces/IAdLabWorkspaceRepository";
import { pool } from "@/lib/db";
import type { QueryResult, QueryResultRow } from "pg";
import { isTransientPostgresConnectionError } from "@/lib/postgresErrors";

interface AdLabWorkspaceRow {
  data: AdLabStore | string;
}

function rowData(row: AdLabWorkspaceRow): AdLabStore {
  return typeof row.data === "string" ? JSON.parse(row.data) as AdLabStore : row.data;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class PostgresAdLabWorkspaceRepository implements IAdLabWorkspaceRepository {
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

  async findByOwnerId(ownerId: string): Promise<AdLabWorkspaceResult> {
    const { rows } = await this.queryWithConnectionRetry<AdLabWorkspaceRow>(
      "SELECT data FROM studio_workspaces WHERE owner_id = $1",
      [ownerId]
    );
    return {
      store: rows[0] ? rowData(rows[0]) : null,
      persistence: "postgresql",
      pendingSync: false,
    };
  }

  async upsert(ownerId: string, data: AdLabStore): Promise<AdLabWorkspaceResult> {
    const { rows } = await this.queryWithConnectionRetry<AdLabWorkspaceRow>(
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

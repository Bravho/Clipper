import { mkdirSync } from "fs";
import { dirname, join } from "path";
import type { StudioStore } from "@/domain/models/Studio";
import type { IStudioWorkspaceRepository, StudioWorkspaceResult } from "@/repositories/interfaces/IStudioWorkspaceRepository";

interface SQLiteStatement {
  get(...params: unknown[]): { data?: string; pending?: number } | undefined;
  run(...params: unknown[]): unknown;
}

interface SQLiteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
}

interface SQLiteModule {
  DatabaseSync: new (path: string) => SQLiteDatabase;
}

function loadSQLite(): SQLiteModule {
  // Avoid a static node:sqlite import so deployments on an older Node runtime
  // can still use PostgreSQL without failing while the module graph loads.
  const runtime = process as typeof process & {
    getBuiltinModule?: (name: string) => unknown;
  };
  const sqlite = runtime.getBuiltinModule?.("node:sqlite") as SQLiteModule | undefined;
  if (!sqlite?.DatabaseSync) {
    throw new Error("Local Studio persistence requires Node.js 22.5 or newer, or configured PostgreSQL credentials.");
  }
  return sqlite;
}

/** Embedded SQLite storage for a zero-configuration local Studio environment. */
export class LocalStudioWorkspaceRepository implements IStudioWorkspaceRepository {
  private database: SQLiteDatabase | null = null;

  constructor(
    private readonly databasePath = process.env.RCLIPPER_STUDIO_DB_PATH
      || join(process.cwd(), "data", "studio.sqlite"),
    private readonly tracksCloudSync = false
  ) {}

  private db(): SQLiteDatabase {
    if (this.database) return this.database;
    mkdirSync(dirname(this.databasePath), { recursive: true });
    const { DatabaseSync } = loadSQLite();
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS studio_workspaces (
        owner_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS studio_workspace_sync_state (
        owner_id TEXT PRIMARY KEY,
        pending INTEGER NOT NULL DEFAULT 1 CHECK (pending IN (0, 1)),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    return this.database;
  }

  private read(ownerId: string): { store: StudioStore | null; pending: boolean } {
    const row = this.db()
      .prepare("SELECT data FROM studio_workspaces WHERE owner_id = ?")
      .get(ownerId);
    if (!row?.data) return { store: null, pending: false };
    const sync = this.db()
      .prepare("SELECT pending FROM studio_workspace_sync_state WHERE owner_id = ?")
      .get(ownerId);
    // Existing SQLite workspaces predate sync metadata and must be uploaded.
    return {
      store: JSON.parse(row.data) as StudioStore,
      pending: this.tracksCloudSync && sync?.pending !== 0,
    };
  }

  async findByOwnerId(ownerId: string): Promise<StudioWorkspaceResult> {
    const local = this.read(ownerId);
    return { store: local.store, persistence: "local", pendingSync: local.pending };
  }

  async upsert(ownerId: string, data: StudioStore): Promise<StudioWorkspaceResult> {
    this.db().prepare(`
      INSERT INTO studio_workspaces (owner_id, data)
      VALUES (?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        data = excluded.data,
        updated_at = CURRENT_TIMESTAMP
    `).run(ownerId, JSON.stringify(data));
    this.db().prepare(`
      INSERT INTO studio_workspace_sync_state (owner_id, pending)
      VALUES (?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET pending = excluded.pending, updated_at = CURRENT_TIMESTAMP
    `).run(ownerId, this.tracksCloudSync ? 1 : 0);
    return { store: data, persistence: "local", pendingSync: this.tracksCloudSync };
  }

  async cacheFromPostgres(ownerId: string, data: StudioStore): Promise<void> {
    await this.upsert(ownerId, data);
    this.markSynced(ownerId);
  }

  markSynced(ownerId: string): void {
    this.db().prepare(`
      INSERT INTO studio_workspace_sync_state (owner_id, pending)
      VALUES (?, 0)
      ON CONFLICT(owner_id) DO UPDATE SET pending = 0, updated_at = CURRENT_TIMESTAMP
    `).run(ownerId);
  }

  /** Primarily used by tests and orderly one-off processes. */
  close(): void {
    this.database?.close();
    this.database = null;
  }
}

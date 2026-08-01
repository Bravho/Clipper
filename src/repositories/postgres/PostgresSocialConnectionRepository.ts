/**
 * PostgreSQL implementation of the social-connection mapping.
 *
 * WHY THIS TABLE EXISTS AT ALL. The provider treats accounts as globally unique
 * within a project: if two RClipper users connect the same Facebook Page, it
 * updates ONE record and the `external_id` reflects whoever connected last.
 * Provider-side filtering therefore cannot be an authorisation boundary, and
 * this table is what actually decides who owns what. Every query is scoped by
 * `user_id`.
 *
 * NO CREDENTIALS ARE STORED. The provider's account payload carries access and
 * refresh tokens; they are dropped in `post-for-me/mappings.ts` and never reach
 * this layer.
 */

import { pool } from "@/lib/db";
import { SocialConnectionStatus } from "@/domain/enums/ManagementStatus";
import type { SocialConnection } from "@/domain/models/SocialConnection";

type Row = Record<string, unknown>;

const asDate = (v: unknown): Date => new Date(v as string);
const asDateOrNull = (v: unknown): Date | null => (v ? new Date(v as string) : null);

function rowToConnection(row: Row): SocialConnection {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    provider: row.provider as string,
    providerAccountId: (row.provider_account_id as string) ?? null,
    providerProjectId: (row.provider_project_id as string) ?? null,
    platform: row.platform as string,
    accountName: (row.account_name as string) ?? null,
    accountUsername: (row.account_username as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
    connectionStatus: row.connection_status as SocialConnectionStatus,
    providerMetadata: (row.provider_metadata as Record<string, unknown>) ?? null,
    connectStateHash: (row.connect_state_hash as string) ?? null,
    connectStateExpiresAt: asDateOrNull(row.connect_state_expires_at),
    connectedAt: asDateOrNull(row.connected_at),
    lastSyncedAt: asDateOrNull(row.last_synced_at),
    disconnectedAt: asDateOrNull(row.disconnected_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export interface ISocialConnectionRepository {
  createPending(input: {
    userId: string;
    provider: string;
    platform: string;
    connectStateHash: string;
    connectStateExpiresAt: Date;
  }): Promise<SocialConnection>;

  /**
   * Store the hash of the issued state token. Only the hash is persisted, so a
   * database leak yields nothing that can be replayed against the callback.
   */
  setStateHash(id: string, stateHash: string): Promise<void>;

  /** Look up a pending connection by its single-use state token hash. */
  findByStateHash(stateHash: string): Promise<SocialConnection | null>;

  /**
   * Attach a provider account to a user, or update it in place.
   *
   * Returns null when the account already belongs to a DIFFERENT user, so the
   * caller can refuse rather than silently reassign someone else's account.
   */
  upsertConnected(input: {
    userId: string;
    provider: string;
    providerAccountId: string;
    platform: string;
    accountName: string | null;
    accountUsername: string | null;
    avatarUrl: string | null;
    providerMetadata: Record<string, unknown> | null;
    providerProjectId: string | null;
  }): Promise<SocialConnection | null>;

  findById(id: string): Promise<SocialConnection | null>;
  findByUserId(userId: string): Promise<SocialConnection[]>;
  /** Live (connected) accounts only — what the composer may publish to. */
  findConnectedByUserId(userId: string): Promise<SocialConnection[]>;
  findByProviderAccountId(
    provider: string,
    providerAccountId: string
  ): Promise<SocialConnection | null>;
  updateStatus(
    id: string,
    status: SocialConnectionStatus
  ): Promise<SocialConnection>;
  /** Retire OAuth attempts once a real provider account has been claimed. */
  removePendingForUserPlatform(
    userId: string,
    provider: string,
    platform: string
  ): Promise<number>;
  /** Clear the single-use state token so a callback cannot be replayed. */
  clearState(id: string): Promise<void>;
  deletePendingOlderThan(cutoff: Date): Promise<number>;
}

export class PostgresSocialConnectionRepository implements ISocialConnectionRepository {
  constructor(private db = pool) {}

  async createPending(input: {
    userId: string;
    provider: string;
    platform: string;
    connectStateHash: string;
    connectStateExpiresAt: Date;
  }): Promise<SocialConnection> {
    const { rows } = await this.db.query(
      `INSERT INTO social_connections
         (user_id, provider, platform, connection_status,
          connect_state_hash, connect_state_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        input.userId,
        input.provider,
        input.platform,
        SocialConnectionStatus.Pending,
        input.connectStateHash,
        input.connectStateExpiresAt,
      ]
    );
    return rowToConnection(rows[0]);
  }

  async setStateHash(id: string, stateHash: string): Promise<void> {
    await this.db.query(
      `UPDATE social_connections
          SET connect_state_hash = $2, updated_at = NOW()
        WHERE id = $1`,
      [id, stateHash]
    );
  }

  async findByStateHash(stateHash: string): Promise<SocialConnection | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM social_connections
        WHERE connect_state_hash = $1 AND connection_status = $2
        LIMIT 1`,
      [stateHash, SocialConnectionStatus.Pending]
    );
    return rows[0] ? rowToConnection(rows[0]) : null;
  }

  async upsertConnected(input: {
    userId: string;
    provider: string;
    providerAccountId: string;
    platform: string;
    accountName: string | null;
    accountUsername: string | null;
    avatarUrl: string | null;
    providerMetadata: Record<string, unknown> | null;
    providerProjectId: string | null;
  }): Promise<SocialConnection | null> {
    // Refuse to move an account between users. The provider would happily let
    // the second connector take it over; we will not, because it would silently
    // hand one customer's publishing rights to another.
    const existing = await this.findByProviderAccountId(
      input.provider,
      input.providerAccountId
    );
    if (existing && existing.userId !== input.userId) return null;

    const { rows } = await this.db.query(
      `INSERT INTO social_connections
         (user_id, provider, provider_account_id, provider_project_id, platform,
          account_name, account_username, avatar_url, connection_status,
          provider_metadata, connected_at, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
       ON CONFLICT (user_id, provider, provider_account_id)
         WHERE provider_account_id IS NOT NULL
       DO UPDATE SET
         platform          = EXCLUDED.platform,
         account_name      = EXCLUDED.account_name,
         account_username  = EXCLUDED.account_username,
         avatar_url        = EXCLUDED.avatar_url,
         connection_status = EXCLUDED.connection_status,
         provider_metadata = EXCLUDED.provider_metadata,
         provider_project_id = EXCLUDED.provider_project_id,
         disconnected_at   = NULL,
         last_synced_at    = NOW(),
         updated_at        = NOW()
       RETURNING *`,
      [
        input.userId,
        input.provider,
        input.providerAccountId,
        input.providerProjectId,
        input.platform,
        input.accountName,
        input.accountUsername,
        input.avatarUrl,
        SocialConnectionStatus.Connected,
        input.providerMetadata,
      ]
    );
    return rows[0] ? rowToConnection(rows[0]) : null;
  }

  async findById(id: string): Promise<SocialConnection | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM social_connections WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToConnection(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<SocialConnection[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM social_connections
        WHERE user_id = $1 AND connection_status <> $2
        ORDER BY created_at DESC`,
      [userId, SocialConnectionStatus.Removed]
    );
    return rows.map(rowToConnection);
  }

  async findConnectedByUserId(userId: string): Promise<SocialConnection[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM social_connections
        WHERE user_id = $1 AND connection_status = $2
        ORDER BY platform ASC, account_username ASC`,
      [userId, SocialConnectionStatus.Connected]
    );
    return rows.map(rowToConnection);
  }

  async findByProviderAccountId(
    provider: string,
    providerAccountId: string
  ): Promise<SocialConnection | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM social_connections
        WHERE provider = $1 AND provider_account_id = $2
        LIMIT 1`,
      [provider, providerAccountId]
    );
    return rows[0] ? rowToConnection(rows[0]) : null;
  }

  async updateStatus(
    id: string,
    status: SocialConnectionStatus
  ): Promise<SocialConnection> {
    const { rows } = await this.db.query(
      `UPDATE social_connections
          SET connection_status = $2,
              disconnected_at = CASE WHEN $2 IN ('disconnected','removed')
                                     THEN NOW() ELSE disconnected_at END,
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [id, status]
    );
    if (!rows[0]) throw new Error("Social connection not found.");
    return rowToConnection(rows[0]);
  }

  async removePendingForUserPlatform(
    userId: string,
    provider: string,
    platform: string
  ): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE social_connections
          SET connection_status = $4,
              connect_state_hash = NULL,
              connect_state_expires_at = NULL,
              disconnected_at = NOW(),
              updated_at = NOW()
        WHERE user_id = $1
          AND provider = $2
          AND platform = $3
          AND connection_status = $5`,
      [
        userId,
        provider,
        platform,
        SocialConnectionStatus.Removed,
        SocialConnectionStatus.Pending,
      ]
    );
    return rowCount ?? 0;
  }

  async clearState(id: string): Promise<void> {
    await this.db.query(
      `UPDATE social_connections
          SET connect_state_hash = NULL,
              connect_state_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
  }

  async deletePendingOlderThan(cutoff: Date): Promise<number> {
    // Abandoned connection attempts (the user closed the OAuth tab) would
    // otherwise accumulate as permanent `pending` rows.
    const { rowCount } = await this.db.query(
      `DELETE FROM social_connections
        WHERE connection_status = $1 AND created_at < $2`,
      [SocialConnectionStatus.Pending, cutoff]
    );
    return rowCount ?? 0;
  }
}

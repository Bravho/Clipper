import { SocialConnectionStatus } from "@/domain/enums/ManagementStatus";

/**
 * A link between an RClipper user and a social account connected through the
 * publishing provider (currently Post for Me).
 *
 * PostgreSQL → `social_connections`.
 *
 * SECURITY: this record holds identifiers and display metadata ONLY. The
 * provider's account payload includes `access_token` and `refresh_token`; those
 * are dropped at the provider boundary and never reach this model, the
 * database, or any log line. RClipper never asks for, receives, or stores a
 * social-media password.
 *
 * WHY WE KEEP OUR OWN MAPPING: the provider treats accounts as globally unique
 * within a project — if two RClipper users connect the same Facebook Page, the
 * provider updates one record rather than creating two. Ownership is therefore
 * ours to enforce, and every query is filtered by `userId`.
 */
export interface SocialConnection {
  id: string;
  userId: string;
  /** Publishing provider key, e.g. "post_for_me". Kept for future providers. */
  provider: string;
  /** The provider's social-account id (e.g. "sa_1234"). Null while pending. */
  providerAccountId: string | null;
  /** The provider project the account belongs to. */
  providerProjectId: string | null;
  /** Provider platform string, e.g. "tiktok" / "instagram". */
  platform: string;
  accountName: string | null;
  accountUsername: string | null;
  avatarUrl: string | null;
  connectionStatus: SocialConnectionStatus;
  /**
   * Non-sensitive provider metadata only (platform ids, capability flags).
   * Token fields are stripped before anything is written here.
   */
  providerMetadata: Record<string, unknown> | null;
  /**
   * Single-use, signed correlation token issued when the auth URL is created
   * and cleared once the callback is claimed. Prevents one user from claiming
   * another user's connection.
   */
  connectStateHash: string | null;
  connectStateExpiresAt: Date | null;
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

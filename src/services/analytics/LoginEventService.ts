import { createHash } from "node:crypto";
import { pool } from "@/lib/db";

/**
 * Sign-in event recorder (migration 028, `user_login_events`).
 *
 * NextAuth runs on the JWT strategy with no adapter and no sessions table, so
 * before this table existed nothing in the database recorded that a sign-in had
 * happened at all — "how many people logged in last week" was not a question the
 * data could answer. Every successful sign-in appends exactly one row here.
 *
 * Writes go through the shared pool directly rather than a repository: the table
 * is append-only analytics with no domain model behind it, which is the same
 * shape as ManagementAuditService / PushNotificationService.
 *
 * EVERY method swallows its errors. A failed analytics INSERT must never turn a
 * valid sign-in into a failed one.
 */

/**
 * Where the sign-in came from.
 *
 * `pwa` cannot be derived from a user agent — an installed PWA sends the same UA
 * as the browser tab it was installed from — so it is only ever recorded when a
 * caller passes it explicitly. UA derivation returns `web` in that case.
 */
export type LoginSurface = "web" | "android" | "ios" | "pwa" | "unknown";

export interface RecordLoginInput {
  userId: string;
  /** NextAuth provider id: credentials | google | apple | google-native | apple-native. */
  provider: string;
  /** Overrides UA derivation when the caller already knows the surface. */
  surface?: LoginSurface;
  /** True only for the sign-in that created the account. */
  isNewUser?: boolean;
  /** Raw client IP. Hashed before storage — the raw value never leaves this call. */
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Minimal shape of the `pg` pool this service needs, so tests can inject a stub
 * without constructing a real Pool (which would try to open a socket).
 */
interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Derive the surface from the user agent.
 *
 * The Capacitor shells are identified by the immutable `RClipperNative/<platform>`
 * suffix their WebView appends to the UA — the same server-visible signal
 * `src/lib/mobile/platform.ts` falls back to on the client before the Capacitor
 * bridge has reported, and the one `/api/credits/topup` already gates on. It is
 * checked before the generic iOS/Android tokens because the native shell's UA
 * also contains "iPhone"/"Android": a Capacitor sign-in must not be filed as a
 * mobile-web one.
 */
export function surfaceFromUserAgent(
  userAgent: string | null | undefined
): LoginSurface {
  if (!userAgent) return "unknown";
  if (userAgent.includes("RClipperNative/ios")) return "ios";
  if (userAgent.includes("RClipperNative/android")) return "android";
  return "web";
}

/**
 * Hash an IP for storage.
 *
 * The raw address is personal data we have no product use for; only "is this the
 * same origin as last time" matters, which a salted digest answers. NEXTAUTH_SECRET
 * is the salt because it is already a required, deployment-specific secret — the
 * digests are therefore not comparable across environments and a leaked table
 * cannot be rainbow-tabled back to addresses.
 *
 * Returns null for an absent IP so the column stays NULL rather than storing the
 * hash of an empty string, which would collide across every such row.
 */
export function hashIp(ip: string | null | undefined): string | null {
  const trimmed = ip?.trim();
  if (!trimmed) return null;
  return createHash("sha256")
    .update(`${trimmed}${process.env.NEXTAUTH_SECRET ?? ""}`)
    .digest("hex");
}

export class LoginEventService {
  constructor(private db: QueryableDb = pool) {}

  /**
   * Append one sign-in row. Fire-and-forget: callers may `void` this.
   *
   * Never throws — a logging outage must not block authentication.
   */
  async recordLogin(input: RecordLoginInput): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO user_login_events
           (user_id, provider, surface, is_new_user, ip_hash, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.userId,
          input.provider,
          input.surface ?? surfaceFromUserAgent(input.userAgent),
          input.isNewUser ?? false,
          hashIp(input.ip),
          input.userAgent ?? null,
        ]
      );
    } catch (err) {
      // Analytics is an audit aid — never let it break a sign-in.
      console.error("[loginEvents] failed to record login:", err);
    }
  }
}

export const loginEventService = new LoginEventService();

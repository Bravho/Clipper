/**
 * Private Ad Lab rollout (channel marketing: ad scripts, publishing to added
 * channels, ad-efficiency analysis). Not to be confused with the phone studio
 * at /studio (config/studioRollout.ts) or Channel Management.
 *
 * This feature is deliberately OFF by default. It is an owner-only web lab and
 * must never become visible merely because a deployment omitted configuration:
 * it needs BOTH the master switch AND an explicit email / user-id allowlist.
 *
 * Variables are RCLIPPER_AD_LAB_*. The earlier RCLIPPER_STUDIO_* names are still
 * read as a fallback so an existing .env.local keeps working.
 *
 * Every reference is a static `process.env.NAME` so the values are read at
 * request time in the middleware (edge) as well as in route handlers.
 * Edge-safe: no Node imports in this file.
 */
function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export const AD_LAB_CONFIG = {
  get enabled(): boolean {
    return (process.env.RCLIPPER_AD_LAB_ENABLED ?? process.env.RCLIPPER_STUDIO_ENABLED) === "true";
  },
  get allowedEmails(): string[] {
    return parseList(
      process.env.RCLIPPER_AD_LAB_ALLOWED_EMAILS ?? process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS
    );
  },
  get allowedUserIds(): string[] {
    return parseList(
      process.env.RCLIPPER_AD_LAB_ALLOWED_USER_IDS ?? process.env.RCLIPPER_STUDIO_ALLOWED_USER_IDS
    );
  },
  /** Phase 4: open to whole email domains (e.g. a client company). */
  get allowedEmailDomains(): string[] {
    return parseList(process.env.RCLIPPER_AD_LAB_ALLOWED_EMAIL_DOMAINS);
  },
  /**
   * Phase 4: percentage rollout, 0–100 (default 0). A user's bucket is a stable
   * hash of their id, so the same users stay in as the number grows. Applies
   * IN ADDITION to the explicit lists, never instead of the master switch.
   */
  get rolloutPercent(): number {
    const value = Number(process.env.RCLIPPER_AD_LAB_ROLLOUT_PERCENT ?? "0");
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  },
  get localAuthEnabled(): boolean {
    return (
      (process.env.RCLIPPER_AD_LAB_LOCAL_AUTH_ENABLED
        ?? process.env.RCLIPPER_STUDIO_LOCAL_AUTH_ENABLED) === "true"
    );
  },
  get localEmail(): string {
    return (
      process.env.RCLIPPER_AD_LAB_LOCAL_EMAIL ?? process.env.RCLIPPER_STUDIO_LOCAL_EMAIL ?? ""
    ).trim();
  },
  get localPassword(): string {
    return process.env.RCLIPPER_AD_LAB_LOCAL_PASSWORD ?? process.env.RCLIPPER_STUDIO_LOCAL_PASSWORD ?? "";
  },
  get sqlitePath(): string {
    return (process.env.RCLIPPER_AD_LAB_DB_PATH ?? process.env.RCLIPPER_STUDIO_DB_PATH ?? "").trim();
  },
  /**
   * Where workspaces are stored:
   *   postgres — PostgreSQL only (the default in production; works on Node 20)
   *   hybrid   — local SQLite first, uploaded with `npm run adlab:sync`
   *   sqlite   — local SQLite only
   * Unset: `postgres` in production, otherwise `hybrid` when PostgreSQL is
   * configured and `sqlite` when it is not.
   */
  get store(): "postgres" | "hybrid" | "sqlite" | null {
    const value = (process.env.RCLIPPER_AD_LAB_STORE ?? "").trim().toLowerCase();
    return value === "postgres" || value === "hybrid" || value === "sqlite" ? value : null;
  },
} as const;

export const AD_LAB_BASE_PATH = "/dashboard/ad-lab";
export const AD_LAB_API_BASE_PATH = "/api/ad-lab";

export function isAdLabPath(pathname: string): boolean {
  return (
    pathname === AD_LAB_BASE_PATH ||
    pathname.startsWith(`${AD_LAB_BASE_PATH}/`) ||
    pathname === AD_LAB_API_BASE_PATH ||
    pathname.startsWith(`${AD_LAB_API_BASE_PATH}/`)
  );
}

export function isAdLabEnabledFor(user: {
  id?: string | null;
  email?: string | null;
}): boolean {
  if (!AD_LAB_CONFIG.enabled) return false;

  const email = (user.email ?? "").trim().toLowerCase();
  const userId = (user.id ?? "").trim().toLowerCase();

  // Requiring an explicit allowlist (or a deliberate rollout percentage) keeps
  // an accidental `enabled=true` from exposing Ad Lab to every user.
  if (email.length > 0 && AD_LAB_CONFIG.allowedEmails.includes(email)) return true;
  if (userId.length > 0 && AD_LAB_CONFIG.allowedUserIds.includes(userId)) return true;

  const domain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";
  if (domain && AD_LAB_CONFIG.allowedEmailDomains.includes(domain)) return true;

  const percent = AD_LAB_CONFIG.rolloutPercent;
  return percent > 0 && userId.length > 0 && adLabRolloutBucket(userId) < percent;
}

/**
 * Stable 0–99 bucket for a user id (FNV-1a). Edge-safe: no Node crypto, so the
 * middleware and route handlers agree on who is in the rollout.
 */
export function adLabRolloutBucket(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

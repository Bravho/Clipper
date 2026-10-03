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

  // Requiring an explicit identity allowlist keeps an accidental `enabled=true`
  // from exposing unfinished Ad Lab screens to every production user.
  return (
    (email.length > 0 && AD_LAB_CONFIG.allowedEmails.includes(email)) ||
    (userId.length > 0 && AD_LAB_CONFIG.allowedUserIds.includes(userId))
  );
}

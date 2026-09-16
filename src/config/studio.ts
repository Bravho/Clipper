/**
 * Private Studio Lab rollout.
 *
 * This feature is deliberately OFF by default. It is an owner-only web lab and
 * must never become visible merely because a deployment omitted configuration.
 */
function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export const STUDIO_CONFIG = {
  get enabled(): boolean {
    return process.env.RCLIPPER_STUDIO_ENABLED === "true";
  },
  get allowedEmails(): string[] {
    return parseList(process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS);
  },
  get allowedUserIds(): string[] {
    return parseList(process.env.RCLIPPER_STUDIO_ALLOWED_USER_IDS);
  },
} as const;

export function isStudioEnabledFor(user: {
  id: string;
  email?: string | null;
}): boolean {
  if (!STUDIO_CONFIG.enabled) return false;

  const email = (user.email ?? "").trim().toLowerCase();
  const userId = user.id.trim().toLowerCase();

  // Requiring an explicit identity allowlist keeps an accidental `enabled=true`
  // from exposing unfinished Studio screens to every production user.
  return (
    (email.length > 0 && STUDIO_CONFIG.allowedEmails.includes(email)) ||
    STUDIO_CONFIG.allowedUserIds.includes(userId)
  );
}

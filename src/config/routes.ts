import { Role } from "@/domain/enums/Role";

/**
 * Application route definitions.
 *
 * Centralised route config for use in:
 * - Middleware route matching
 * - Role-based redirect logic
 * - Navigation components
 */
export const ROUTES = {
  // Public
  HOME: "/",
  LOGIN: "/login",
  SIGNUP: "/signup",
  TERMS: "/terms",
  OWNERSHIP: "/ownership",
  PRIVACY: "/privacy",
  SUPPORT: "/support",
  DELETE_ACCOUNT: "/delete-account",

  // Email verification
  VERIFY_EMAIL: "/verify-email",
  VERIFY_EMAIL_CONFIRM: "/verify-email/confirm",

  // Authenticated (role-specific)
  DASHBOARD: "/dashboard",
  ADMIN: "/admin",
  ACCOUNT: "/account",

  // Requester Portal — Phase 2B
  REQUESTS: "/dashboard/requests",
  REQUESTS_NEW: "/dashboard/requests/new",
  CREDITS: "/dashboard/credits",
  LEGAL: "/dashboard/legal",

  // RClipper Management — nested under /dashboard so it inherits the existing
  // Requester-only middleware gate with no middleware change.
  MANAGEMENT: "/dashboard/management",
  MANAGEMENT_CONTENT: "/dashboard/management/content",
  MANAGEMENT_CONNECTIONS: "/dashboard/management/connections",
  MANAGEMENT_POSTS: "/dashboard/management/posts",
  MANAGEMENT_CALENDAR: "/dashboard/management/calendar",
  MANAGEMENT_PAYMENTS: "/dashboard/management/payments",
} as const;

/** Build a request detail URL. */
export function requestDetailPath(requestId: string): string {
  return `/dashboard/requests/${requestId}`;
}

/** Build a Management content detail URL. */
export function managementContentPath(contentId: string): string {
  return `/dashboard/management/content/${contentId}`;
}

/** Return to Channel Management with the publishing flow reopened for one item. */
export function managementPublishReturnPath(contentId: string): string {
  const query = new URLSearchParams({ publish: contentId });
  return `${ROUTES.MANAGEMENT}?${query.toString()}#management-video-${contentId}`;
}

/** Open Publishing Packages while preserving the in-Management return point. */
export function managementPaymentsPath(returnTo: string = ROUTES.MANAGEMENT): string {
  const query = new URLSearchParams({ returnTo });
  return `${ROUTES.MANAGEMENT_PAYMENTS}?${query.toString()}`;
}

/**
 * Restrict package-page redirects to this user's Channel Management area.
 * External, malformed, and self-referencing destinations fall back to its hub.
 */
export function safeManagementReturnPath(value?: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return ROUTES.MANAGEMENT;
  }

  try {
    const base = "https://rclipper.local";
    const parsed = new URL(value, base);
    const insideManagement =
      parsed.origin === base &&
      (parsed.pathname === ROUTES.MANAGEMENT ||
        parsed.pathname.startsWith(`${ROUTES.MANAGEMENT}/`));

    if (!insideManagement || parsed.pathname === ROUTES.MANAGEMENT_PAYMENTS) {
      return ROUTES.MANAGEMENT;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return ROUTES.MANAGEMENT;
  }
}

/**
 * Returns the home dashboard route for a given role.
 * Used after login to redirect users to the correct page.
 */
export function getRoleHomePath(role: Role): string {
  switch (role) {
    case Role.Admin:
      return ROUTES.ADMIN;
    case Role.Requester:
    default:
      return ROUTES.DASHBOARD;
  }
}

/** Routes that require authentication (matched by middleware) */
export const PROTECTED_ROUTE_PREFIXES = [
  ROUTES.DASHBOARD,
  ROUTES.ADMIN,
  ROUTES.ACCOUNT,
];

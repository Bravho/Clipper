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

  // Email verification
  VERIFY_EMAIL: "/verify-email",
  VERIFY_EMAIL_CONFIRM: "/verify-email/confirm",

  // Authenticated (role-specific)
  DASHBOARD: "/dashboard",
  STAFF: "/staff",
  ADMIN: "/admin",
  ACCOUNT: "/account",

  // Requester Portal — Phase 2B
  REQUESTS: "/dashboard/requests",
  REQUESTS_NEW: "/dashboard/requests/new",
  CREDITS: "/dashboard/credits",
  LEGAL: "/dashboard/legal",
} as const;

/** Build a request detail URL. */
export function requestDetailPath(requestId: string): string {
  return `/dashboard/requests/${requestId}`;
}

/**
 * Returns the home dashboard route for a given role.
 * Used after login to redirect users to the correct page.
 */
export function getRoleHomePath(role: Role): string {
  switch (role) {
    case Role.Admin:
      return ROUTES.ADMIN;
    case Role.Staff:
      return ROUTES.STAFF;
    case Role.Requester:
    default:
      return ROUTES.DASHBOARD;
  }
}

/** Routes that require authentication (matched by middleware) */
export const PROTECTED_ROUTE_PREFIXES = [
  ROUTES.DASHBOARD,
  ROUTES.STAFF,
  ROUTES.ADMIN,
  ROUTES.ACCOUNT,
];

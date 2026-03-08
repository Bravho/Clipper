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

  // Authenticated (role-specific)
  DASHBOARD: "/dashboard",
  STAFF: "/staff",
  ADMIN: "/admin",
  ACCOUNT: "/account",
} as const;

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

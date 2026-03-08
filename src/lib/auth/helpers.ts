import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { ROUTES, getRoleHomePath } from "@/config/routes";

/**
 * Auth helper utilities for server components and API routes.
 *
 * Use these helpers instead of calling getServerSession() directly.
 * They provide type-safe access and enforce auth/role requirements.
 */

/** Retrieve the current session. Returns null if unauthenticated. */
export async function getCurrentSession() {
  return getServerSession(authOptions);
}

/** Retrieve the current user from the session. Returns null if unauthenticated. */
export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

/**
 * Require authentication. Redirects to login if not authenticated.
 * Returns the current user.
 *
 * Usage: const user = await requireAuth()
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    redirect(ROUTES.LOGIN);
  }
  return user;
}

/**
 * Require a specific role. Redirects unauthenticated users to login,
 * and wrong-role users to their appropriate home route.
 *
 * Usage: const user = await requireRole(Role.Admin)
 */
export async function requireRole(...allowedRoles: Role[]) {
  const user = await requireAuth();
  if (!allowedRoles.includes(user.role)) {
    // Redirect to the user's correct home instead of an error page
    redirect(getRoleHomePath(user.role));
  }
  return user;
}

/** Check if the current user has one of the given roles (non-redirecting). */
export async function hasRole(...roles: Role[]): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return roles.includes(user.role);
}

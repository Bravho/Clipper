import { withAuth, NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { logAuthEvent } from "@/lib/auth/diagnostics";

/**
 * Clipper route protection middleware.
 *
 * Auth check: the `authorized` callback returns false for unauthenticated users,
 * which causes NextAuth to redirect them to the configured signIn page (/login).
 *
 * Role check: the inner middleware function enforces role-based access.
 * Wrong-role users are redirected to their correct home route.
 *
 * Route mapping:
 *   /dashboard  → Requester only
 *   /admin      → Admin only
 *   /account    → Any authenticated user
 */
export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    const { pathname } = req.nextUrl;
    const role = req.nextauth.token?.role as Role | undefined;

    if (!role) {
      logAuthEvent("middleware_redirect", {
        path: pathname,
        reason: "missing_role",
      });
      // Should not happen (authorized callback guards this), but be safe
      return NextResponse.redirect(new URL(ROUTES.LOGIN, req.url));
    }

    // /admin — Admin only
    if (pathname.startsWith(ROUTES.ADMIN)) {
      if (role !== Role.Admin) {
        logAuthEvent("middleware_redirect", {
          path: pathname,
          role,
          reason: "admin_role_mismatch",
        });
        return NextResponse.redirect(new URL(ROUTES.DASHBOARD, req.url));
      }
    }

    // /dashboard — Requester only
    if (pathname.startsWith(ROUTES.DASHBOARD)) {
      if (role !== Role.Requester) {
        logAuthEvent("middleware_redirect", {
          path: pathname,
          role,
          reason: "requester_role_mismatch",
        });
        return NextResponse.redirect(new URL(ROUTES.ADMIN, req.url));
      }
    }

    // /account — any authenticated role (no additional check needed)
    logAuthEvent("middleware_allowed", { path: pathname, role });
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/account/:path*",
  ],
};

import { withAuth, NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";

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
 *   /staff      → Staff or Admin
 *   /admin      → Admin only
 *   /account    → Any authenticated user
 */
export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    const { pathname } = req.nextUrl;
    const role = req.nextauth.token?.role as Role | undefined;

    if (!role) {
      // Should not happen (authorized callback guards this), but be safe
      return NextResponse.redirect(new URL(ROUTES.LOGIN, req.url));
    }

    // /admin — Admin only
    if (pathname.startsWith(ROUTES.ADMIN)) {
      if (role !== Role.Admin) {
        return NextResponse.redirect(
          new URL(
            role === Role.Staff ? ROUTES.STAFF : ROUTES.DASHBOARD,
            req.url
          )
        );
      }
    }

    // /staff — Staff or Admin
    if (pathname.startsWith(ROUTES.STAFF)) {
      if (role !== Role.Staff && role !== Role.Admin) {
        return NextResponse.redirect(new URL(ROUTES.DASHBOARD, req.url));
      }
    }

    // /dashboard — Requester only
    if (pathname.startsWith(ROUTES.DASHBOARD)) {
      if (role !== Role.Requester) {
        return NextResponse.redirect(
          new URL(
            role === Role.Admin ? ROUTES.ADMIN : ROUTES.STAFF,
            req.url
          )
        );
      }
    }

    // /account — any authenticated role (no additional check needed)
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
    "/staff/:path*",
    "/admin/:path*",
    "/account/:path*",
  ],
};

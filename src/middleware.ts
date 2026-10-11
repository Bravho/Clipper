import { withAuth, NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { logAuthEvent } from "@/lib/auth/diagnostics";
import { isAppUserAgent } from "@/lib/mobile/appUserAgent";
import { isAppOnlyPath, isBrowserMarketingOnly } from "@/config/studioRollout";


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
 *   /studio     → Requester only (the phone studio)
 *   /admin      → Admin only
 *   /account    → Any authenticated user
 *
 * Browser vs app: the app shells append `RClipperNative/<platform>` to the
 * user agent. With BROWSER_MARKETING_ONLY on, a requester in a web browser is
 * sent to "get the app" only for the video-making pages
 * (APP_ONLY_REQUESTER_PATHS). Admin pages are never affected.
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

    // /dashboard and /studio — Requester only
    if (pathname.startsWith(ROUTES.DASHBOARD) || pathname.startsWith(ROUTES.STUDIO)) {
      if (role !== Role.Requester) {
        logAuthEvent("middleware_redirect", {
          path: pathname,
          role,
          reason: "requester_role_mismatch",
        });
        return NextResponse.redirect(new URL(ROUTES.ADMIN, req.url));
      }
    }

    // Making a video happens in the app; a browser gets "download the app".
    if (
      role === Role.Requester &&
      isBrowserMarketingOnly() &&
      !isAppUserAgent(req.headers.get("user-agent")) &&
      isAppOnlyPath(pathname)
    ) {
      logAuthEvent("middleware_redirect", {
        path: pathname,
        role,
        reason: "browser_marketing_only",
      });
      return NextResponse.redirect(new URL(ROUTES.GET_THE_APP, req.url));
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
    "/studio/:path*",
    "/admin/:path*",
    "/account/:path*",
  ],
};

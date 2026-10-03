import { withAuth, NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { logAuthEvent } from "@/lib/auth/diagnostics";
import { isAppUserAgent } from "@/lib/mobile/appUserAgent";
import { isBrowserMarketingOnly } from "@/config/studioRollout";

/**
 * Requester pages a WEB BROWSER may still open once the browser is the
 * marketing site (BROWSER_MARKETING_ONLY): the account, credits and pricing
 * (Stripe top-ups and packages stay available on the web), the legal page,
 * and the two Channel Management pages a browser can land on by itself — the
 * social-account OAuth return and the publishing-package purchase.
 * Everything else a requester does happens in the app.
 */
const BROWSER_REQUESTER_PATHS = [
  ROUTES.ACCOUNT,
  ROUTES.CREDITS,
  ROUTES.PRICING,
  ROUTES.LEGAL,
  ROUTES.MANAGEMENT_CONNECTIONS,
  ROUTES.MANAGEMENT_PAYMENTS,
];

function browserMayOpen(pathname: string): boolean {
  return BROWSER_REQUESTER_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`)
  );
}

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
 * sent to "get the app" for everything but BROWSER_REQUESTER_PATHS. Admin
 * pages are never affected — admins work in a browser.
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

    // The browser is the marketing site: requester work happens in the app.
    if (
      role === Role.Requester &&
      isBrowserMarketingOnly() &&
      !isAppUserAgent(req.headers.get("user-agent")) &&
      !browserMayOpen(pathname)
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

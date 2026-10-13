/** Pure path rules for {@link AppBackButton}, kept JSX-free so they are unit-testable. */

/** Pages that ARE the top of the app: nothing to go back to. */
const TOP_LEVEL_PATHS = new Set(["/", "/dashboard", "/admin", "/staff", "/login", "/signup", "/offline"]);

export function isTopLevelPath(pathname: string | null): boolean {
  if (!pathname) return true;
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TOP_LEVEL_PATHS.has(trimmed);
}

/** Where "back" goes when there is no history: one level up, or the dashboard. */
export function parentPath(pathname: string): string {
  if (pathname.startsWith("/studio")) return "/dashboard";
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 1) return "/dashboard";
  parts.pop();
  // /dashboard/requests/new → /dashboard/requests; /admin/analytics/funnel →
  // /admin/analytics has no page, so fall back to the section root.
  const up = `/${parts.join("/")}`;
  return up === "/admin/analytics" ? "/admin" : up;
}

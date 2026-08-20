import { ROUTES } from "@/config/routes";
import type { PortalNavLink } from "@/components/layout/PortalNav";

/**
 * Admin portal navigation — the single source of truth.
 *
 * Two surfaces render from this file and must never drift:
 *   1. `AdminShell` — the desktop left sidebar (`lg` and up).
 *   2. The global navbar hamburger — `AdminShell` registers each group into the
 *      `PortalNav` registry, and `MobileNavDrawer` renders `title` as a heading
 *      above the group's links. Grouping therefore costs nothing extra on mobile.
 *
 * The admin dashboard's "Quick Links" block also reads from here, because it
 * used to be a hand-maintained duplicate of the nav list and fell out of sync.
 *
 * Labels are deliberately hardcoded English: the entire admin surface is English
 * and `src/i18n/messages.ts` has no `admin.*` namespace. Adding one would mean
 * adding every key to all three locales (`MessageKey` is typed off the Thai
 * object), which is a larger change than this nav rework warrants.
 */

export interface AdminNavGroup {
  /** Stable id — `PortalNav` replaces rather than duplicates on re-register. */
  id: string;
  /** Heading shown above the links in both the sidebar and the mobile drawer. */
  title: string;
  links: PortalNavLink[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "admin-operations",
    title: "Operations",
    links: [
      { href: ROUTES.ADMIN, label: "Dashboard", icon: "▣" },
      { href: ROUTES.ADMIN_REQUESTS, label: "Requests", icon: "◫" },
      { href: ROUTES.ADMIN_QUEUE, label: "Render Queue", icon: "⧗" },
      { href: ROUTES.ADMIN_USERS, label: "Users", icon: "◉" },
    ],
  },
  {
    id: "admin-analytics",
    title: "Analytics",
    links: [
      { href: ROUTES.ADMIN_ANALYTICS_FUNNEL, label: "Conversion Funnel", icon: "◈" },
      { href: ROUTES.ADMIN_ANALYTICS_PIPELINE, label: "Pipeline Timing", icon: "⌛" },
      { href: ROUTES.ADMIN_ANALYTICS_APPROVALS, label: "Approval Activity", icon: "⊞" },
      { href: ROUTES.ADMIN_ANALYTICS_CAPACITY, label: "Capacity & CPU", icon: "⚙" },
    ],
  },
  {
    id: "admin-money",
    title: "Money",
    links: [
      { href: ROUTES.ADMIN_PAYMENTS, label: "Payments", icon: "฿" },
      { href: ROUTES.ADMIN_CREDITS, label: "Credits", icon: "▤" },
    ],
  },
  {
    id: "admin-support",
    title: "Support",
    links: [{ href: ROUTES.ADMIN_FEEDBACK, label: "Feedback & Reports", icon: "✉" }],
  },
];

/** Every admin link, flattened — used by the dashboard's Quick Links block. */
export const ADMIN_NAV_LINKS: PortalNavLink[] = ADMIN_NAV_GROUPS.flatMap(
  (group) => group.links
);

/**
 * Is `pathname` inside `href`?
 *
 * `/admin` is excluded from prefix matching because it is a prefix of every
 * other admin route and would otherwise always report active.
 */
export function isAdminLinkActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  if (href === ROUTES.ADMIN) return false;
  return pathname.startsWith(`${href}/`);
}

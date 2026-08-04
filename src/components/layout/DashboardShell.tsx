"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { ROUTES } from "@/config/routes";
import { useRegisterPortalNav } from "@/components/layout/PortalNav";
import { useI18n } from "@/i18n/client";

/**
 * Requester dashboard shell (sidebar + content area).
 *
 * Extracted from the former client-component layout so that
 * `app/(auth)/dashboard/layout.tsx` can be a SERVER component and evaluate the
 * RClipper Management feature flag there. The flag must never be decided in the
 * browser — the nav item is only rendered when the server says this user is in
 * the rollout, and the routes behind it re-check independently.
 *
 * Responsive behaviour:
 * - `lg` and up: persistent left sidebar, as before.
 * - Below `lg` (phones, and tablets in portrait): the sidebar is hidden and the
 *   same links are registered into the global navbar hamburger via
 *   `useRegisterPortalNav`, so no navigation becomes unreachable. The old
 *   "RClipper Portal" strip is gone — it duplicated the navbar and cost 56px of
 *   vertical space without being actionable.
 */
export function DashboardShell({
  children,
  showManagement = false,
}: {
  children: React.ReactNode;
  /** Server-evaluated: is RClipper Management enabled for this user? */
  showManagement?: boolean;
}) {
  const { t } = useI18n();
  const pathname = usePathname();

  const navLinks = [
    { href: ROUTES.DASHBOARD, label: t("nav.dashboard"), icon: "▣" },
    { href: ROUTES.REQUESTS, label: t("sidebar.requests"), icon: "◫" },
    { href: ROUTES.CREDITS, label: t("sidebar.credits"), icon: "◈" },
    ...(showManagement
      ? [
          { href: ROUTES.MANAGEMENT, label: t("sidebar.management"), icon: "◉" },
          { href: ROUTES.MANAGEMENT_CONNECTIONS, label: t("sidebar.channels"), icon: "⚙" },
          { href: ROUTES.MANAGEMENT_POSTS, label: t("sidebar.posts"), icon: "▤" },
        ]
      : []),
  ];

  // Mirror these links into the navbar hamburger for small screens.
  useRegisterPortalNav({ id: "requester-portal", title: "RClipper Portal", links: navLinks });

  return (
    <div className="flex w-full min-w-0 bg-slate-50">
      <aside className="hidden w-56 flex-shrink-0 self-stretch border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center px-5">
          <span className="text-sm font-bold tracking-tight text-slate-900">RClipper</span>
          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            Portal
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {navLinks.map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== ROUTES.DASHBOARD && pathname?.startsWith(`${link.href}/`));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-blue-50 font-medium text-blue-800"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <span className="text-base opacity-60">{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <p className="text-xs text-slate-400">
            {t("sidebar.help")}{" "}
            <Link href="/support" className="text-blue-600 hover:underline">
              {t("sidebar.contact")}
            </Link>
          </p>
        </div>
      </aside>

      {/* min-w-0 is load-bearing: without it this flex child refuses to shrink
          below its content width and the whole page scrolls sideways. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

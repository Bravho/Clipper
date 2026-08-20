"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { ADMIN_NAV_GROUPS, isAdminLinkActive } from "@/config/adminNav";
import { useRegisterPortalNavSections } from "@/components/layout/PortalNav";

/**
 * Admin portal shell — grouped left sidebar on desktop, hamburger on mobile.
 *
 * Replaces the former `AdminNav` horizontal tab strip. That strip put nine tabs
 * in a single `overflow-x-auto` row, which stopped scanning well once the
 * analytics and money sections were added; it also broke at `md`, leaving the
 * 768–1023px band with no navigation at all (the strip was hidden below `md`
 * and the hamburger only appears below `lg`).
 *
 * The two surfaces are driven by ONE definition in `src/config/adminNav.ts`:
 * this component renders the sidebar directly and registers each group into the
 * `PortalNav` registry, which the navbar's `MobileNavDrawer` renders — group
 * headings included. Adding a link is a one-line change in that config.
 *
 * Red accents distinguish the admin portal from the requester portal's blue,
 * matching the red "Admin Portal" label the old strip carried.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useRegisterPortalNavSections(ADMIN_NAV_GROUPS);

  return (
    <div className="flex w-full min-w-0 bg-slate-50">
      <aside className="hidden w-56 flex-shrink-0 self-stretch border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center px-5">
          <span className="text-sm font-bold tracking-tight text-slate-900">RClipper</span>
          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            Admin
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {group.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.links.map((link) => {
                  const active = isAdminLinkActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-red-50 font-medium text-red-800"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <span className="w-4 text-base opacity-60">{link.icon}</span>
                      <span className="min-w-0">{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* min-w-0 is load-bearing: without it this flex child refuses to shrink
          below its content width and the whole page scrolls sideways. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}

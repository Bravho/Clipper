"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { useRegisterPortalNav, type PortalNavLink } from "@/components/layout/PortalNav";

const ADMIN_LINKS: PortalNavLink[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/production-review", label: "Production Review" },
  { href: "/admin/queue", label: "Queue" },
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/delivery", label: "Delivery" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/credits", label: "Credits" },
  { href: "/admin/workload", label: "Workload" },
  { href: "/admin/sla", label: "SLA" },
];

/**
 * Admin portal navigation strip.
 *
 * On `md` and up this stays a horizontal scrolling tab bar. On phones the strip
 * is hidden entirely — nine tabs in a horizontal scroller is a poor target on a
 * 390px screen — and the same links are registered into the global navbar
 * hamburger instead.
 */
export function AdminNav() {
  const pathname = usePathname();

  useRegisterPortalNav({ id: "admin-portal", title: "Admin Portal", links: ADMIN_LINKS });

  return (
    <nav className="hidden border-b border-slate-200 bg-white md:block">
      <div className="mx-auto w-full max-w-7xl px-4">
        <div className="flex h-12 items-center gap-1 overflow-x-auto">
          <span className="mr-3 shrink-0 text-xs font-bold uppercase tracking-widest text-red-500">
            Admin Portal
          </span>
          <span className="mr-3 h-4 w-px shrink-0 bg-slate-200" />
          {ADMIN_LINKS.map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== "/admin" && pathname?.startsWith(`${link.href}/`));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "shrink-0 rounded px-3 py-1.5 text-sm font-medium transition",
                  active
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

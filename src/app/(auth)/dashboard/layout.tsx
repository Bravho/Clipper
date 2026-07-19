"use client";

import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { useI18n } from "@/i18n/client";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const navLinks = [
    { href: ROUTES.DASHBOARD, label: t("nav.dashboard"), icon: "▣" },
    { href: ROUTES.REQUESTS, label: t("sidebar.requests"), icon: "◫" },
    { href: ROUTES.CREDITS, label: t("sidebar.credits"), icon: "◈" },
  ] as const;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-56 flex-shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center border-b border-slate-100 px-5">
          <span className="text-sm font-bold tracking-tight text-slate-900">RClipper</span>
          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            Portal
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <span className="text-base opacity-60">{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <p className="text-xs text-slate-400">
            {t("sidebar.help")}{" "}
            <a href="mailto:support@rclipper.com" className="text-blue-600 hover:underline">
              {t("sidebar.contact")}
            </a>
          </p>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
          <span className="text-sm font-bold text-slate-900">RClipper Portal</span>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

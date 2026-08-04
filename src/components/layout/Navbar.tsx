"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useCallback, useState } from "react";
import { ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LanguageSelector } from "@/components/layout/LanguageSelector";
import { MobileNavDrawer } from "@/components/layout/MobileNavDrawer";
import { usePortalNav } from "@/components/layout/PortalNav";
import { useI18n } from "@/i18n/client";

const roleBadgeVariant: Record<Role, "blue" | "green" | "red"> = {
  [Role.Requester]: "blue",
  [Role.Admin]: "red",
};

export function Navbar() {
  const { t } = useI18n();
  const { data: session, status } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLoading = status === "loading";
  const user = session?.user;

  // Section navigation registered by the active portal shell (requester
  // sidebar, admin nav). On desktop those render in their own surface; on
  // mobile they fold into this hamburger so nothing becomes unreachable.
  const portalSections = usePortalNav();

  const closeDrawer = useCallback(() => setMobileOpen(false), []);

  const dashboardHref = user?.role === Role.Admin ? ROUTES.ADMIN : ROUTES.DASHBOARD;

  return (
    <nav className="app-safe-top sticky top-0 z-30 border-b border-slate-700 bg-slate-900">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-3 sm:h-16">
          {/* Logo — allowed to shrink so it never pushes the hamburger off-screen */}
          <Link href={ROUTES.HOME} className="flex min-w-0 items-center gap-2">
            <Image
              src="/logo.png"
              alt="RClipper logo"
              width={36}
              height={36}
              className="h-8 w-8 flex-shrink-0 rounded sm:h-9 sm:w-9"
            />
            <span className="truncate text-lg font-bold tracking-tight text-white sm:text-xl">
              RClipper
            </span>
          </Link>

          {/* Desktop nav — only from lg up, because the tablet width still needs
              the drawer to reach the section links. */}
          <div className="hidden items-center gap-4 lg:flex">
            {isLoading ? null : user ? (
              <>
                <Link href={dashboardHref} className="text-sm text-slate-300 hover:text-white">
                  {t("nav.dashboard")}
                </Link>
                <Link href={ROUTES.ACCOUNT} className="text-sm text-slate-300 hover:text-white">
                  {t("nav.account")}
                </Link>
                <div className="flex items-center gap-3 border-l border-slate-700 pl-4">
                  <Badge variant={roleBadgeVariant[user.role]}>{user.role}</Badge>
                  <span className="max-w-[160px] truncate text-sm text-slate-400">
                    {user.name}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => signOut({ callbackUrl: ROUTES.HOME })}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    {t("nav.signOut")}
                  </Button>
                  <LanguageSelector />
                </div>
              </>
            ) : (
              <>
                <Link href={ROUTES.LOGIN} className="text-sm text-slate-300 hover:text-white">
                  {t("nav.signIn")}
                </Link>
                <Link href={ROUTES.SIGNUP}>
                  <Button size="sm">{t("nav.getStarted")}</Button>
                </Link>
                <LanguageSelector />
              </>
            )}
          </div>

          {/* Mobile / tablet menu button — 44px hit target per iOS HIG */}
          <button
            type="button"
            className="-mr-2 flex-shrink-0 rounded p-2.5 text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </div>

      <MobileNavDrawer open={mobileOpen} onClose={closeDrawer} sections={portalSections}>
        {user ? (
          <>
            <div className="flex items-center gap-2 px-3 pb-2">
              <Badge variant={roleBadgeVariant[user.role]}>{user.role}</Badge>
              <span className="min-w-0 truncate text-sm text-slate-400">{user.name}</span>
            </div>
            <Link
              href={dashboardHref}
              className="rounded-md px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
              onClick={closeDrawer}
            >
              {t("nav.dashboard")}
            </Link>
            <Link
              href={ROUTES.ACCOUNT}
              className="rounded-md px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
              onClick={closeDrawer}
            >
              {t("nav.account")}
            </Link>
            <button
              type="button"
              onClick={() => {
                closeDrawer();
                signOut({ callbackUrl: ROUTES.HOME });
              }}
              className="rounded-md px-3 py-2.5 text-left text-sm text-red-400 hover:bg-slate-800 hover:text-red-300"
            >
              {t("nav.signOut")}
            </button>
            <div className="px-3 pt-3">
              <LanguageSelector />
            </div>
          </>
        ) : (
          <>
            <Link
              href={ROUTES.LOGIN}
              className="rounded-md px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
              onClick={closeDrawer}
            >
              {t("nav.signIn")}
            </Link>
            <Link
              href={ROUTES.SIGNUP}
              className="rounded-md px-3 py-2.5 text-sm text-blue-400 hover:bg-slate-800"
              onClick={closeDrawer}
            >
              {t("nav.getStarted")}
            </Link>
            <div className="px-3 pt-3">
              <LanguageSelector />
            </div>
          </>
        )}
      </MobileNavDrawer>
    </nav>
  );
}

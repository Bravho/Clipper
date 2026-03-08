"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";
import { clsx } from "clsx";
import { ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const roleBadgeVariant: Record<Role, "blue" | "green" | "red"> = {
  [Role.Requester]: "blue",
  [Role.Staff]: "green",
  [Role.Admin]: "red",
};

export function Navbar() {
  const { data: session, status } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLoading = status === "loading";
  const user = session?.user;

  const dashboardHref =
    user?.role === Role.Admin
      ? ROUTES.ADMIN
      : user?.role === Role.Staff
        ? ROUTES.STAFF
        : ROUTES.DASHBOARD;

  return (
    <nav className="border-b border-slate-200 bg-slate-900">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href={ROUTES.HOME} className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-white">
              Clipper
            </span>
            <span className="hidden rounded bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white sm:block">
              Platform
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-4 md:flex">
            {isLoading ? null : user ? (
              <>
                <Link
                  href={dashboardHref}
                  className="text-sm text-slate-300 hover:text-white"
                >
                  Dashboard
                </Link>
                <Link
                  href={ROUTES.ACCOUNT}
                  className="text-sm text-slate-300 hover:text-white"
                >
                  Account
                </Link>
                <div className="flex items-center gap-3 pl-4 border-l border-slate-700">
                  <Badge variant={roleBadgeVariant[user.role]}>
                    {user.role}
                  </Badge>
                  <span className="text-sm text-slate-400 max-w-[160px] truncate">
                    {user.name}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => signOut({ callbackUrl: ROUTES.HOME })}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    Sign out
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Link
                  href={ROUTES.LOGIN}
                  className="text-sm text-slate-300 hover:text-white"
                >
                  Sign in
                </Link>
                <Link href={ROUTES.SIGNUP}>
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden text-slate-300 hover:text-white"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="border-t border-slate-700 bg-slate-900 px-4 py-3 md:hidden">
          {user ? (
            <div className="flex flex-col gap-3">
              <span className="text-sm text-slate-400">{user.name}</span>
              <Link href={dashboardHref} className="text-sm text-slate-300" onClick={() => setMobileOpen(false)}>
                Dashboard
              </Link>
              <Link href={ROUTES.ACCOUNT} className="text-sm text-slate-300" onClick={() => setMobileOpen(false)}>
                Account
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: ROUTES.HOME })}
                className="text-left text-sm text-red-400 hover:text-red-300"
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Link href={ROUTES.LOGIN} className="text-sm text-slate-300" onClick={() => setMobileOpen(false)}>
                Sign in
              </Link>
              <Link href={ROUTES.SIGNUP} className="text-sm text-blue-400" onClick={() => setMobileOpen(false)}>
                Create account
              </Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { ROUTES } from "@/config/routes";

const links = [
  { href: ROUTES.STUDIO_BRANDS, label: "Brands", detail: "ข้อมูลแบรนด์" },
  { href: ROUTES.STUDIO_CREATE, label: "Create", detail: "สร้างสคริปต์" },
  { href: ROUTES.STUDIO_PUBLISHING, label: "Publishing", detail: "เตรียมเผยแพร่" },
  { href: ROUTES.STUDIO_ANALYZE, label: "Analyze", detail: "วิเคราะห์ผล" },
];

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-950">RClipper Studio</h1>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  Private Lab
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                วางแผนสคริปต์ เผยแพร่ และเรียนรู้จากผลโฆษณาใน workflow เดียว
              </p>
            </div>
            <span className="text-xs text-slate-400">ข้อมูล MVP เก็บใน browser เครื่องนี้</span>
          </div>
          <nav className="mt-5 flex gap-2 overflow-x-auto" aria-label="Studio navigation">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    "min-w-fit rounded-lg border px-4 py-2 text-sm transition-colors",
                    active
                      ? "border-blue-700 bg-blue-700 font-semibold text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                  )}
                >
                  {link.label}
                  <span className={clsx("ml-2 text-xs", active ? "text-blue-100" : "text-slate-400")}>
                    {link.detail}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";

export const metadata: Metadata = { title: "Admin Portal — RClipper" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(Role.Admin);

  const navLinks = [
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

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-12 items-center gap-1 overflow-x-auto">
            <span className="mr-3 shrink-0 text-xs font-bold uppercase tracking-widest text-red-500">
              Admin Portal
            </span>
            <span className="mr-3 h-4 w-px shrink-0 bg-slate-200" />
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="shrink-0 rounded px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

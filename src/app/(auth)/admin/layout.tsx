import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { AdminNav } from "@/components/layout/AdminNav";

export const metadata: Metadata = { title: "Admin Portal — RClipper" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(Role.Admin);

  return (
    <div className="w-full min-w-0 bg-slate-50">
      <AdminNav />
      <main className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { AdminShell } from "@/components/layout/AdminShell";
import { isCampaignOperator } from "@/config/merchantCampaigns";

export const metadata: Metadata = { title: "Admin Portal — RClipper" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(Role.Admin);

  // AdminShell owns the sidebar, the max-width content column and the mobile
  // nav registration. The layout's only remaining job is the role gate.
  return <AdminShell showCampaigns={isCampaignOperator(user.email)}>{children}</AdminShell>;
}

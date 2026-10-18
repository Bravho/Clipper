import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { isCampaignOperator } from "@/config/merchantCampaigns";
import { isManagementEnabledFor } from "@/config/management";
import { AdminShell } from "@/components/layout/AdminShell";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { CampaignAdmin } from "@/features/campaigns/admin/CampaignAdmin";

export const metadata: Metadata = { title: "Shop Campaigns — RClipper" };
export const dynamic = "force-dynamic";

/**
 * /campaigns — Merchant Referral Campaigns operator page.
 *
 * Only the operator e-mails (`CAMPAIGN_OPERATOR_EMAILS`, default
 * bravegreatheart@gmail.com and zephyrothz@hotmail.com), whatever the role;
 * everyone else gets a 404. Drawn inside the shell of the account's own role,
 * so it sits in the same left sidebar (desktop) and hamburger (phone) as the
 * rest of their menu. The API re-checks the e-mail on every call.
 */
export default async function CampaignsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isCampaignOperator(session.user.email)) notFound();

  if (session.user.role === Role.Admin) {
    return (
      <AdminShell showCampaigns>
        <CampaignAdmin />
      </AdminShell>
    );
  }

  const showManagement = isManagementEnabledFor({
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
  });
  return (
    <DashboardShell showManagement={showManagement} showCampaigns>
      <CampaignAdmin />
    </DashboardShell>
  );
}

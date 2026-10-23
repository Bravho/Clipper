/** PATCH /api/campaign-admin/merchants/:id — edit a shop. Operators only. */
import { NextRequest, NextResponse } from "next/server";
import { merchantCampaignAdminService } from "@/services/campaigns";
import { adminFailure, body, requireCampaignOperator } from "../../_guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireCampaignOperator();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await merchantCampaignAdminService.updateMerchant(params.id, await body(request)));
  } catch (error) {
    return adminFailure(error, "PATCH merchants");
  }
}

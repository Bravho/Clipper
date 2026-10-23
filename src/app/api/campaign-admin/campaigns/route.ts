/** POST /api/campaign-admin/campaigns — create a campaign. Operators only. */
import { NextRequest, NextResponse } from "next/server";
import { merchantCampaignAdminService } from "@/services/campaigns";
import { adminFailure, body, requireCampaignOperator } from "../_guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireCampaignOperator();
  if (!guard.ok) return guard.response;
  try {
    const created = await merchantCampaignAdminService.createCampaign(await body(request), guard.user.id);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return adminFailure(error, "POST campaigns");
  }
}

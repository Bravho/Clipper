/** GET /api/campaign-admin — shops, templates, campaigns (with QR link + stats). Operators only. */
import { NextRequest, NextResponse } from "next/server";
import { merchantCampaignAdminService } from "@/services/campaigns";
import { appOrigin } from "@/lib/appOrigin";
import { adminFailure, requireCampaignOperator } from "./_guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireCampaignOperator();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await merchantCampaignAdminService.overview(appOrigin(request)));
  } catch (error) {
    return adminFailure(error, "GET overview");
  }
}

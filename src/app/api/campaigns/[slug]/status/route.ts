/**
 * GET /api/campaigns/:slug/status?k=<qr key>   (public, no login)
 * Header: X-Install-Id
 *
 * "creator-campaign-status": the creator's code, videos made, reward state
 * (last granted, next eligible) and the post links they added.
 */
import { NextRequest, NextResponse } from "next/server";
import { campaignCreatorService } from "@/services/campaigns";
import { NO_STORE, accessOf, failure, installIdOf, limited } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const blocked = limited(request, "read");
  if (blocked) return blocked;
  try {
    const status = await campaignCreatorService.status(accessOf(params.slug, request), installIdOf(request));
    return NextResponse.json({ status }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "GET status");
  }
}

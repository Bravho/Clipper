/**
 * POST /api/campaigns/:slug/video-made   (public, no login)
 * Body: { k }   Header: X-Install-Id
 *
 * The phone finished rendering a quick video (counted for the operator).
 */
import { NextRequest, NextResponse } from "next/server";
import { campaignCreatorService } from "@/services/campaigns";
import { NO_STORE, accessOf, failure, installIdOf, limited, readJson } from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const blocked = limited(request, "write");
  if (blocked) return blocked;
  try {
    const body = await readJson(request);
    const result = await campaignCreatorService.recordVideoMade(
      accessOf(params.slug, request, body),
      installIdOf(request)
    );
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "POST video-made");
  }
}

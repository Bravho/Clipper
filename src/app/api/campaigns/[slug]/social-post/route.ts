/**
 * POST /api/campaigns/:slug/social-post   (public, no login, optional step)
 * Body: { k, url }   Header: X-Install-Id
 *
 * "social-post-url": the link of the post the customer published themselves.
 * RClipper never posts for them and never connects their social accounts.
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
    const result = await campaignCreatorService.addSocialPost(
      accessOf(params.slug, request, body),
      installIdOf(request),
      body.url
    );
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "POST social-post");
  }
}

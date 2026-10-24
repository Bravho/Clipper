/**
 * POST /api/campaigns/:slug/session   (public, no login)
 * Body: { k }   Header: X-Install-Id: <random UUID kept by the app>
 *
 * "creator/session": finds or creates the anonymous creator for this phone
 * (only a peppered hash of the install id is stored) and its entry in the
 * campaign, which issues the immutable referral code on first call.
 * Returns the public campaign view and the creator's status.
 */
import { NextRequest, NextResponse } from "next/server";
import { campaignCreatorService } from "@/services/campaigns";
import { NO_STORE, accessOf, failure, installIdOf, limited, platformOf, readJson, signalsOf } from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const blocked = limited(request, "session");
  if (blocked) return blocked;
  try {
    const body = await readJson(request);
    const { resolved, status } = await campaignCreatorService.startSession(
      accessOf(params.slug, request, body),
      installIdOf(request),
      platformOf(request),
      signalsOf(request)
    );
    return NextResponse.json(
      { campaign: campaignCreatorService.publicView(resolved), status },
      { headers: NO_STORE }
    );
  } catch (error) {
    return failure(error, "POST session");
  }
}

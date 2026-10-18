/**
 * POST /api/campaigns/:slug/referral-code   (public, no login)
 *
 * The creator's referral code for this campaign — created on first call,
 * identical on every later call (codes are immutable once issued). Same
 * inputs as /session; kept as its own endpoint for clients that only need
 * the code.
 */
import { NextRequest, NextResponse } from "next/server";
import { campaignCreatorService } from "@/services/campaigns";
import { NO_STORE, accessOf, failure, installIdOf, limited, platformOf, readJson } from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const blocked = limited(request, "session");
  if (blocked) return blocked;
  try {
    const body = await readJson(request);
    const { entry, creator } = await campaignCreatorService.startSession(
      accessOf(params.slug, request, body),
      installIdOf(request),
      platformOf(request)
    );
    return NextResponse.json(
      { referralCode: entry.referralCode, creatorId: creator.id, campaignSlug: params.slug },
      { headers: NO_STORE }
    );
  } catch (error) {
    return failure(error, "POST referral-code");
  }
}

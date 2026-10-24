/**
 * POST /api/campaigns/:slug/phone/verify   (public, no login)
 * Body: { k, challengeId, code, phone }   Header: X-Install-Id
 *
 * Checks the SMS code. On success the phone becomes the creator's verified
 * phone and is handed to iTravy with the creator's referral code, so iTravy
 * can refuse that phone as a redeemer of its own code. → { status }
 */
import { NextRequest, NextResponse } from "next/server";
import { campaignCreatorService } from "@/services/campaigns";
import { NO_STORE, accessOf, failure, installIdOf, limited, readJson, signalsOf } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const blocked = limited(request, "write");
  if (blocked) return blocked;
  try {
    const body = await readJson(request);
    const status = await campaignCreatorService.verifyOtp(
      accessOf(params.slug, request, body),
      installIdOf(request),
      { challengeId: body.challengeId, code: body.code, phone: body.phone },
      signalsOf(request)
    );
    return NextResponse.json({ status }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "POST phone/verify");
  }
}

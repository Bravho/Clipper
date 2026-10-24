/**
 * POST /api/campaigns/:slug/phone/send   (public, no login)
 * Body: { k, phone, lang? }   Header: X-Install-Id
 *
 * Sends a 6-digit SMS code to the creator's phone (5 minutes, 5 tries).
 * Throttled per install and per phone before anything is sent.
 * → { challengeId, maskedPhone, expiresInSeconds, resendAfterSeconds }
 */
import { NextRequest, NextResponse } from "next/server";
import { campaignCreatorService } from "@/services/campaigns";
import { NO_STORE, accessOf, failure, installIdOf, limited, readJson } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const blocked = limited(request, "session");
  if (blocked) return blocked;
  try {
    const body = await readJson(request);
    const result = await campaignCreatorService.requestOtp(
      accessOf(params.slug, request, body),
      installIdOf(request),
      body.phone,
      typeof body.lang === "string" ? body.lang : null
    );
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "POST phone/send");
  }
}

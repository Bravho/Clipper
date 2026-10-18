/**
 * GET /api/travy/referral-codes/:code
 *
 * Server-to-server, for iTravy / TravyBuzz: look up a Merchant Campaign
 * referral code (case-insensitive) before showing a friend the discount.
 * Authenticated with the shared `RCLIPPER_API_KEY` (`X-API-Key`), like every
 * /api/travy route.
 *
 * 200 { code, valid, reason, creatorId, merchant, campaign, issuedAt }
 * 404 when the code does not exist. iTravy should also check that the code's
 * merchant is the shop where it is being redeemed — that is what makes a
 * mistyped code very unlikely to count.
 *
 * Read-only. Redemption tokens and commission live in iTravy (later).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTravyApiKey } from "../../_guard";
import { campaignCreatorService } from "@/services/campaigns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const guard = requireTravyApiKey(request);
  if (!guard.ok) return guard.response;
  try {
    const view = await campaignCreatorService.lookupCode(params.code);
    if (!view) {
      return NextResponse.json({ error: "Referral code not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/travy/referral-codes]", error);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
}

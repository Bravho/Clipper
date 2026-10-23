/**
 * POST /api/campaigns/:slug/reward-claim   (public, no login)
 * Body: { k }   Header: X-Install-Id
 *
 * "Show staff": records a creator-reward claim. Granted unless this device
 * already got one from this campaign within its cooldown (then refused and
 * recorded as `rejected_limit`, with the date it becomes available again).
 * Always 200 with `granted` — a refusal is an expected answer, not an error.
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
    const result = await campaignCreatorService.claimReward(
      accessOf(params.slug, request, body),
      installIdOf(request)
    );
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "POST reward-claim");
  }
}

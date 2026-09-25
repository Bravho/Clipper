import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/helpers";
import { getStudioQuota } from "@/services/studioQuota";

export const dynamic = "force-dynamic";

/**
 * GET /api/video-packages/quota
 *
 * The signed-in account's current video allowance. Read-only.
 *
 * The phone studio renders its quota once on the server; after a package is
 * bought on Pricing and the user comes back, that first value (and the Next
 * router cache of the page) still says "none left". The studio re-reads this
 * whenever it is shown again, so a live package clears the warning at once.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  try {
    const quota = await getStudioQuota(user.id);
    return NextResponse.json(quota, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[GET /api/video-packages/quota]", err);
    return NextResponse.json({ error: "Could not read the quota." }, { status: 500 });
  }
}

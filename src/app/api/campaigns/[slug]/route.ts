/**
 * GET /api/campaigns/:slug?k=<qr key>   (public, no login)
 *
 * The campaign behind a scanned QR: shop name, location, the friend discount,
 * the creator reward, the template's default sentence and sound, and the music
 * catalogue the customer can pick from. Never returns the QR key.
 */
import { NextRequest, NextResponse } from "next/server";
import { campaignCreatorService } from "@/services/campaigns";
import { NO_STORE, accessOf, failure, limited } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const blocked = limited(request, "read");
  if (blocked) return blocked;
  try {
    const resolved = await campaignCreatorService.resolve(accessOf(params.slug, request));
    return NextResponse.json({ campaign: campaignCreatorService.publicView(resolved) }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "GET campaign");
  }
}

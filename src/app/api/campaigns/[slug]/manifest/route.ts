/**
 * POST /api/campaigns/:slug/manifest   (public, no login)
 * Body: { k, localId, mimeType, durationSeconds, statement, sound }
 * Header: X-Install-Id
 *
 * The render manifest for the Merchant Quick Video — the same v4 contract the
 * studio uses, validated the same way. The PHONE renders it; the clip itself
 * never reaches the server (only its length and type do).
 */
import { NextRequest, NextResponse } from "next/server";
import { campaignCreatorService } from "@/services/campaigns";
import { appOrigin } from "@/lib/appOrigin";
import { NO_STORE, accessOf, failure, installIdOf, limited, readJson, signalsOf } from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const blocked = limited(request, "write");
  if (blocked) return blocked;
  try {
    const body = await readJson(request);
    const result = await campaignCreatorService.renderManifest(
      accessOf(params.slug, request, body),
      installIdOf(request),
      body,
      appOrigin(request),
      signalsOf(request)
    );
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "POST manifest");
  }
}

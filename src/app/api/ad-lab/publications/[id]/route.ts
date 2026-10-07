import { NextResponse } from "next/server";
import { adLabPublishingService } from "@/services/ad-lab/AdLabPublishingService";
import { adLabErrorResponse, requireAdLabUser } from "../../_guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/ad-lab/publications/:id — remove a FAILED publication with its
 * targets, metric history and uploaded video. Refused (409) once anything went live.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    await adLabPublishingService.deleteFailed(guard.user.id, params.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return adLabErrorResponse("DELETE /api/ad-lab/publications/:id", err);
  }
}

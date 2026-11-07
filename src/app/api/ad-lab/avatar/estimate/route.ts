import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdLabUser } from "../../_guard";
import { avatarService } from "../_service";
import { avatarErrorResponse } from "../_avatarGuard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  draftId: z.string().trim().min(1).max(255),
});

/** POST /api/ad-lab/avatar/estimate — cost estimate for a script draft. */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json(await avatarService.estimate(guard.user.id, parsed.data.draftId));
  } catch (err) {
    return avatarErrorResponse("POST /api/ad-lab/avatar/estimate", err);
  }
}

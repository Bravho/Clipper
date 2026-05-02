import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { staffWorkflowService } from "@/services/staff/StaffWorkflowService";
import { z } from "zod";

const schema = z.object({
  note: z.string().trim().max(1000).optional(),
});

/**
 * POST /api/staff/requests/[id]/approve-publishing
 * Approve production review — moves to Publishing.
 * Moves: ScheduledForPublishing → Published
 *
 * TODO: Admin Portal — restrict to admin role only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    const request = await staffWorkflowService.approveForPublishing(params.id, parsed.data.note);
    return NextResponse.json({ request });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

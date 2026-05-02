import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { staffWorkflowService } from "@/services/staff/StaffWorkflowService";
import { putOnHoldSchema } from "@/features/staff/validation/staffActionSchemas";

/**
 * POST /api/staff/requests/[id]/hold
 * Place a request On Hold with a reason shown to the requester.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);
    const body = await req.json();
    const parsed = putOnHoldSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    const request = await staffWorkflowService.putOnHold(
      params.id,
      parsed.data.holdReason,
      parsed.data.note
    );
    return NextResponse.json({ request });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

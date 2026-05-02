import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { staffWorkflowService } from "@/services/staff/StaffWorkflowService";

/**
 * POST /api/admin/requests/[id]/deliver
 *
 * Admin marks a Published request as Delivered.
 * Moves: Published → Delivered
 *
 * Body: { note?: string }
 * Access: Admin only.
 *
 * NOTE: Admin can also trigger delivery (normally staff action) for operational control.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(Role.Admin);
    const { id: requestId } = await params;
    const body = await req.json().catch(() => ({}));
    const note = typeof body.note === "string" ? body.note : undefined;

    const request = await staffWorkflowService.markDelivered(
      requestId,
      note ?? "Marked delivered by admin."
    );

    return NextResponse.json({ request }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

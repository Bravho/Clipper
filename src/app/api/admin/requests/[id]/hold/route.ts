import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { adminWorkflowService } from "@/services/admin/AdminWorkflowService";
import { holdDuringReviewSchema } from "@/features/admin/validation/adminActionSchemas";

/**
 * POST /api/admin/requests/[id]/hold
 *
 * Admin puts a request on hold during production review.
 * Moves: ScheduledForPublishing → OnHold
 * Updates: ProductionReview → OnHold
 *
 * Body: { holdReason: string, reviewNote?: string }
 * Access: Admin only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole(Role.Admin);
    const { id: requestId } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = holdDuringReviewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const result = await adminWorkflowService.holdDuringReview(
      requestId,
      user.id,
      parsed.data.holdReason,
      parsed.data.reviewNote
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

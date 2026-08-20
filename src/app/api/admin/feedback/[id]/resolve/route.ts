import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/helpers";
import { apiErrorResponse, ApiValidationError } from "@/lib/api/adminResponse";
import { Role } from "@/domain/enums/Role";
import { adminFeedbackService } from "@/services/admin/AdminFeedbackService";
import { resolveReportSchema } from "@/features/admin/validation/feedbackSchemas";

/**
 * POST /api/admin/feedback/[id]/resolve
 *
 * "Mark solved": open | reviewing → resolved, stamping `resolved_at` and the
 * optional closing note. Accepting from `open` is deliberate — a report an admin
 * can fix on sight should not need a pointless "accept for review" click first.
 *
 * Body: { note?: string }
 * Access: Admin only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireApiRole(Role.Admin);
    const { id } = await params;

    // The note is optional, so a body-less POST must parse as `{}` rather than
    // failing on JSON.parse of an empty payload.
    const parsed = resolveReportSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.errors[0].message);
    }

    const report = await adminFeedbackService.resolve(id, admin.id, parsed.data.note);
    return NextResponse.json({ report }, { status: 200 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

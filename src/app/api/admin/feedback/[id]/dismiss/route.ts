import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/helpers";
import { apiErrorResponse, ApiValidationError } from "@/lib/api/adminResponse";
import { Role } from "@/domain/enums/Role";
import { adminFeedbackService } from "@/services/admin/AdminFeedbackService";
import { dismissReportSchema } from "@/features/admin/validation/feedbackSchemas";

/**
 * POST /api/admin/feedback/[id]/dismiss
 *
 * open | reviewing → dismissed, for spam, duplicates and reports that turn out
 * to describe nothing actionable. Distinct from "resolve" so the two never blur:
 * the resolved count is meant to mean "we changed something".
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

    const parsed = dismissReportSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.errors[0].message);
    }

    const report = await adminFeedbackService.dismiss(id, admin.id, parsed.data.note);
    return NextResponse.json({ report }, { status: 200 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

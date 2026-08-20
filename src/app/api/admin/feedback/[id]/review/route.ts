import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/helpers";
import { apiErrorResponse, ApiValidationError } from "@/lib/api/adminResponse";
import { Role } from "@/domain/enums/Role";
import { adminFeedbackService } from "@/services/admin/AdminFeedbackService";
import { startReviewSchema } from "@/features/admin/validation/feedbackSchemas";

/**
 * POST /api/admin/feedback/[id]/review
 *
 * "Accept for review": open → reviewing, claiming the report for the admin who
 * clicked. Valid from `open` only — re-accepting something already in review, or
 * reopening a closed report, is a different action and does not exist yet.
 *
 * Access: Admin only. Uses `requireApiRole`, not the page helper `requireRole`,
 * whose internal `redirect()` throws a NEXT_REDIRECT that this try/catch would
 * turn into a misleading 400.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireApiRole(Role.Admin);
    const { id } = await params;

    // Body is empty by design; parsing an absent/malformed body as `{}` keeps
    // a `fetch` with no `body` from 400-ing on JSON.parse.
    const parsed = startReviewSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.errors[0].message);
    }

    const report = await adminFeedbackService.startReview(id, admin.id);
    return NextResponse.json({ report }, { status: 200 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

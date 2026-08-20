import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/helpers";
import { apiErrorResponse } from "@/lib/api/adminResponse";
import { Role } from "@/domain/enums/Role";
import { parseDateRange } from "@/features/admin/dateRange";
import { adminPaymentsService, toCsv } from "@/services/admin/AdminPaymentsService";

/**
 * GET /api/admin/payments/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Every money event in the window, both product lines, as CSV.
 *
 * The range is parsed by the same `parseDateRange` the page uses, so the button
 * on `/admin/payments` exports exactly the window on screen — including the
 * silent fallback to the default 30 days when the params are missing or
 * malformed.
 *
 * Access: admin only, via `requireApiRole`. The page helper `requireRole` would
 * `redirect()` here, and a route handler's catch turns that into a 400 carrying
 * "NEXT_REDIRECT" — which reads as "your request was malformed" when the truth
 * is "you are not an admin".
 *
 * Only route handlers may be exported from this file (Next type-checks the
 * module's export shape), so the CSV serialiser lives beside the query that
 * feeds it in `AdminPaymentsService`.
 */
export async function GET(req: NextRequest) {
  try {
    await requireApiRole(Role.Admin);

    const range = parseDateRange({
      from: req.nextUrl.searchParams.get("from") ?? undefined,
      to: req.nextUrl.searchParams.get("to") ?? undefined,
    });

    const events = await adminPaymentsService.getMoneyEvents(range);
    const filename = `rclipper-payments-${range.fromInput}-to-${range.toInput}.csv`;

    return new NextResponse(toCsv(events), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // The figures move as payments settle; a cached copy is a wrong copy.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

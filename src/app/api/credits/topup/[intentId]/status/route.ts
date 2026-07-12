import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { paymentService } from "@/services/PaymentService";

export const dynamic = "force-dynamic";

/**
 * GET /api/credits/topup/[intentId]/status
 *
 * Polling endpoint for the top-up UI. Besides reporting the intent's status, it
 * acts as a SETTLEMENT BACKSTOP: for a still-Pending intent it re-verifies the
 * payment against the gateway (throttled per-intent) and credits the wallet if
 * the customer has paid — so a top-up settles even when the gateway webhook is
 * never delivered. Wall-clock expiry is reported without being persisted, so a
 * late-but-real payment can still settle. See PaymentService.pollIntentStatus.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ intentId: string }> }
) {
  const { intentId } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  if (session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const result = await paymentService.pollIntentStatus(intentId, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ status: result.status });
}

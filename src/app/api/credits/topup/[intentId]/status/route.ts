import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { paymentService } from "@/services/PaymentService";
import { PaymentStatus } from "@/domain/enums/PaymentStatus";

/**
 * GET /api/credits/topup/[intentId]/status
 * Lightweight polling endpoint for the top-up UI. Returns the intent status and,
 * if it has expired by wall-clock but the webhook hasn't fired, reports "expired".
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

  const intent = await paymentService.getIntent(intentId);
  if (!intent || intent.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let status = intent.status;
  if (
    status === PaymentStatus.Pending &&
    intent.expiresAt.getTime() < Date.now()
  ) {
    status = PaymentStatus.Expired;
  }

  return NextResponse.json({ status });
}
